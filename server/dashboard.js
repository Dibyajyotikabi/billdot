import { db } from './db.js';
import { hydrate } from './repos/documents.js';
import { round2 } from '../public/js/shared/calc.js';
import { localToday } from '../public/js/shared/format.js';

function monthKeys(count) {
  const keys = [];
  const d = new Date();
  d.setDate(1);
  for (let i = count - 1; i >= 0; i -= 1) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    keys.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

export function dashboard() {
  const today = localToday();
  const thisMonth = today.slice(0, 7);
  const open = db.prepare(`SELECT * FROM documents
    WHERE type IN ('invoice', 'proforma') AND status NOT IN ('draft', 'void', 'paid')`).all().map(hydrate);

  const invoices = open.filter((d) => d.type === 'invoice');
  const overdue = invoices.filter((d) => d.display_status === 'overdue');
  const claimed = open.filter((d) => d.display_status === 'claimed');
  const sum = (list) => round2(list.reduce((s, d) => s + d.balance, 0));

  const keys = monthKeys(6);
  // Receipts made from an invoice repeat money already logged as that invoice's payment.
  const rows = db.prepare(`
    SELECT substr(date, 1, 7) AS month, SUM(amount) AS amount FROM payments WHERE date >= ? GROUP BY month
    UNION ALL
    SELECT substr(issue_date, 1, 7) AS month, SUM(total) AS amount FROM documents
      WHERE type = 'receipt' AND status = 'paid' AND issue_date >= ?
        AND (parent_id IS NULL OR parent_id NOT IN (SELECT id FROM documents WHERE type IN ('invoice', 'proforma')))
      GROUP BY month`).all(`${keys[0]}-01`, `${keys[0]}-01`);
  const byMonth = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of rows) if (r.month in byMonth) byMonth[r.month] = round2(byMonth[r.month] + r.amount);

  const counts = db.prepare(`SELECT
      SUM(status = 'draft') AS drafts,
      SUM(type = 'quote' AND status IN ('sent', 'viewed')) AS open_quotes,
      COUNT(*) AS total_docs
    FROM documents`).get();

  const activity = db.prepare(`SELECT a.*, d.number, d.type FROM activity a
    LEFT JOIN documents d ON d.id = a.document_id ORDER BY a.id DESC LIMIT 14`).all();

  return {
    currency: open[0]?.currency || null,
    outstanding: sum(invoices),
    outstandingCount: invoices.length,
    overdue: sum(overdue),
    overdueCount: overdue.length,
    collectedThisMonth: byMonth[thisMonth] || 0,
    months: keys.map((k) => ({ month: k, amount: byMonth[k] })),
    drafts: counts.drafts || 0,
    openQuotes: counts.open_quotes || 0,
    totalDocs: counts.total_docs || 0,
    attention: [...claimed, ...overdue].slice(0, 8).map(({ items, ...d }) => d),
    activity,
  };
}
