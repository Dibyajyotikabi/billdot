import { db, kvSet } from '../db.js';
import {
  DEFAULT_SETTINGS, businessCode, defaultBusinessId, profileOf, sanitize, saveProfile,
} from '../settings.js';
import { HttpError, nowIso, v } from '../util.js';

// One row per business with its totals, so the list doubles as a ledger.
export function listBusinesses() {
  const defaultId = defaultBusinessId();
  return db.prepare(`SELECT b.*,
      COUNT(d.id) AS documents,
      COALESCE(SUM(d.type = 'invoice'), 0) AS invoices,
      COALESCE(SUM(CASE WHEN d.type IN ('invoice', 'proforma') AND d.status NOT IN ('void', 'draft') THEN d.total END), 0) AS billed,
      COALESCE(SUM(CASE WHEN d.type IN ('invoice', 'proforma', 'receipt') AND d.status <> 'void' THEN d.amount_paid END), 0) AS collected,
      COALESCE(SUM(CASE WHEN d.type IN ('invoice', 'proforma') AND d.status NOT IN ('void', 'draft')
        THEN MAX(d.total - d.amount_paid, 0) END), 0) AS outstanding,
      MAX(d.issue_date) AS last_issued
    FROM businesses b LEFT JOIN documents d ON d.business_id = b.id
    GROUP BY b.id ORDER BY b.id`).all().map((row) => {
    const { profile, ...rest } = row;
    return { ...rest, ...profileOf(row), code: businessCode(row.id), isDefault: row.id === defaultId };
  });
}

// A new business starts with its own number series (B02-INV-2026-0001) so it never collides.
export function createBusiness(input = {}) {
  const name = v.str(input.name, 200);
  if (!name) throw new HttpError(400, 'Give the business a name.');
  const now = nowIso();
  const { lastInsertRowid } = db.prepare('INSERT INTO businesses (name, profile, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(name, '{}', now, now);
  const id = Number(lastInsertRowid);
  const code = businessCode(id);
  const numbering = Object.fromEntries(Object.entries(DEFAULT_SETTINGS.numbering)
    .map(([type, cfg]) => [type, { ...cfg, prefix: `${code}-${cfg.prefix}` }]));
  const clean = sanitize(DEFAULT_SETTINGS, { business: input.business || {}, payment: input.payment || {} });
  saveProfile(id, { business: { ...clean.business, name }, payment: clean.payment || {}, numbering });
  return listBusinesses().find((b) => b.id === id);
}

export function setDefaultBusiness(id) {
  if (!db.prepare('SELECT 1 FROM businesses WHERE id = ?').get(id)) throw new HttpError(404, 'Business not found.');
  kvSet('defaultBusinessId', id);
}

export function deleteBusiness(id) {
  const biz = listBusinesses().find((b) => b.id === id);
  if (!biz) throw new HttpError(404, 'Business not found.');
  if (biz.isDefault) throw new HttpError(409, 'Make another business the default first.');
  if (biz.documents > 0) throw new HttpError(409, `${biz.code} has ${biz.documents} documents. Delete or move them first.`);
  db.prepare('DELETE FROM businesses WHERE id = ?').run(id);
}
