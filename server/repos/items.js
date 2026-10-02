import { db } from '../db.js';
import { HttpError, nowIso, v } from '../util.js';

function cleanItem(input = {}) {
  return {
    name: v.str(input.name, 200),
    description: v.str(input.description, 1000),
    rate: v.num(input.rate, { min: 0 }),
    unit: v.str(input.unit, 30),
    tax_rate: v.num(input.tax_rate, { min: 0, max: 100 }),
  };
}

export function listItems({ q = '' } = {}) {
  const like = `%${q}%`;
  return db.prepare(`SELECT * FROM items WHERE (? = '' OR name LIKE ? OR description LIKE ?)
    ORDER BY usage_count DESC, name COLLATE NOCASE LIMIT 500`).all(q, like, like);
}

export function saveItem(input, id = null) {
  const it = cleanItem(input);
  if (!it.name) throw new HttpError(400, 'Item name is required.');
  try {
    if (id) {
      const { changes } = db.prepare(`UPDATE items SET name = ?, description = ?, rate = ?, unit = ?, tax_rate = ?, updated_at = ?
        WHERE id = ?`).run(it.name, it.description, it.rate, it.unit, it.tax_rate, nowIso(), id);
      if (!changes) throw new HttpError(404, 'Item not found.');
      return db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    }
    const { lastInsertRowid } = db.prepare(`INSERT INTO items (name, description, rate, unit, tax_rate, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(it.name, it.description, it.rate, it.unit, it.tax_rate, nowIso());
    return db.prepare('SELECT * FROM items WHERE id = ?').get(Number(lastInsertRowid));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new HttpError(409, `An item called "${it.name}" already exists.`);
    throw err;
  }
}

export function deleteItem(id) {
  db.prepare('DELETE FROM items WHERE id = ?').run(id);
}

// Every line used on a document is remembered with its latest price.
export function rememberItems(lines, { countUsage }) {
  const stmt = db.prepare(`INSERT INTO items (name, description, rate, unit, tax_rate, usage_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (name) DO UPDATE SET
      description = CASE WHEN excluded.description <> '' THEN excluded.description ELSE items.description END,
      rate = excluded.rate, unit = excluded.unit, tax_rate = excluded.tax_rate,
      usage_count = items.usage_count + ?, updated_at = excluded.updated_at`);
  const inc = countUsage ? 1 : 0;
  for (const line of lines) {
    if (!line.name) continue;
    stmt.run(line.name, line.description || '', line.rate, line.unit || '', line.tax_rate, inc, nowIso(), inc);
  }
}
