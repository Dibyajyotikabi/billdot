import { db } from '../db.js';
import { HttpError, nowIso, v } from '../util.js';

const FIELDS = ['name', 'company', 'email', 'phone', 'address', 'tax_id', 'notes'];

export function cleanClient(input = {}) {
  return {
    name: v.str(input.name, 200),
    company: v.str(input.company, 200),
    email: v.email(input.email),
    phone: v.str(input.phone, 60),
    address: v.str(input.address, 1000),
    tax_id: v.str(input.tax_id, 80),
    notes: v.str(input.notes, 2000),
  };
}

const SUMMARY_SQL = `
  SELECT c.*,
    COUNT(d.id) AS doc_count,
    COALESCE(SUM(CASE WHEN d.type = 'invoice' AND d.status NOT IN ('draft', 'void') THEN d.total END), 0) AS billed,
    COALESCE(SUM(CASE WHEN d.type = 'invoice' AND d.status NOT IN ('draft', 'void', 'paid')
      THEN MAX(d.total - d.amount_paid, 0) END), 0) AS outstanding,
    MAX(d.issue_date) AS last_activity
  FROM clients c
  LEFT JOIN documents d ON d.client_id = c.id`;

export function listClients({ q = '' } = {}) {
  const like = `%${q}%`;
  return db.prepare(`${SUMMARY_SQL}
    WHERE (? = '' OR c.name LIKE ? OR c.company LIKE ? OR c.email LIKE ?)
    GROUP BY c.id ORDER BY last_activity IS NULL, last_activity DESC, c.name COLLATE NOCASE`)
    .all(q, like, like, like);
}

export function getClient(id) {
  const client = db.prepare(`${SUMMARY_SQL} WHERE c.id = ? GROUP BY c.id`).get(id);
  if (!client) throw new HttpError(404, 'Client not found.');
  return client;
}

export function createClient(input) {
  const c = cleanClient(input);
  if (!c.name) throw new HttpError(400, 'Client name is required.');
  const now = nowIso();
  const { lastInsertRowid } = db.prepare(`INSERT INTO clients (${FIELDS.join(', ')}, created_at, updated_at)
    VALUES (${FIELDS.map(() => '?').join(', ')}, ?, ?)`).run(...FIELDS.map((f) => c[f]), now, now);
  return getClient(Number(lastInsertRowid));
}

export function updateClient(id, input) {
  getClient(id);
  const c = cleanClient(input);
  if (!c.name) throw new HttpError(400, 'Client name is required.');
  db.prepare(`UPDATE clients SET ${FIELDS.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...FIELDS.map((f) => c[f]), nowIso(), id);
  return getClient(id);
}

export function deleteClient(id) {
  getClient(id);
  db.prepare('DELETE FROM clients WHERE id = ?').run(id);
}

// Finds the client a document refers to, creating or refreshing the saved
// record so names and contact details are remembered for next time.
export function resolveClient(snapshot) {
  const c = cleanClient(snapshot);
  if (!c.name) return { id: null, snapshot: c };
  let row = null;
  const id = Number(snapshot.id);
  if (Number.isInteger(id) && id > 0) row = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  if (!row) row = db.prepare('SELECT * FROM clients WHERE name = ? COLLATE NOCASE ORDER BY id LIMIT 1').get(c.name);

  if (!row) {
    const created = createClient(c);
    return { id: created.id, snapshot: { ...c, id: created.id } };
  }
  const merged = { ...row };
  for (const f of FIELDS) {
    if (f !== 'notes' && c[f]) merged[f] = c[f];
  }
  db.prepare(`UPDATE clients SET ${FIELDS.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...FIELDS.map((f) => merged[f]), nowIso(), row.id);
  const { notes, created_at, updated_at, ...rest } = merged;
  return { id: row.id, snapshot: { ...rest, id: row.id } };
}
