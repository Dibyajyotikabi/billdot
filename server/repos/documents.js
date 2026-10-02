import { db, transaction } from '../db.js';
import {
  getSettings, saveSettings, settingsFor, businessExists, defaultBusinessId,
} from '../settings.js';
import { resolveClient } from './clients.js';
import { rememberItems } from './items.js';
import { emit } from '../events.js';
import { DOC_TYPES, FORMATS, PAYMENT_METHODS, effectiveStatus } from '../../public/js/shared/doc-types.js';
import { computeTotals, round2 } from '../../public/js/shared/calc.js';
import { addDays, localToday } from '../../public/js/shared/format.js';
import { HttpError, newToken, nowIso, parseJson, v } from '../util.js';

const INTERVALS = ['weekly', 'monthly', 'quarterly', 'yearly'];
const STATUSES = ['draft', 'sent', 'viewed', 'claimed', 'paid', 'accepted', 'declined', 'void'];

export function hydrate(row) {
  if (!row) return null;
  const doc = {
    ...row,
    client: parseJson(row.client, {}),
    items: parseJson(row.items, []),
    recurring: parseJson(row.recurring, null),
    claim: parseJson(row.claim, null),
  };
  doc.display_status = effectiveStatus(doc, localToday());
  doc.balance = round2(Math.max(doc.total - doc.amount_paid, 0));
  return doc;
}

export function logActivity(documentId, kind, message) {
  db.prepare('INSERT INTO activity (document_id, kind, message, created_at) VALUES (?, ?, ?, ?)')
    .run(documentId, kind, message, nowIso());
}

/* ---------- numbering ---------- */

function renderNumber(cfg, n) {
  const d = new Date();
  const prefix = String(cfg.prefix || '')
    .replace('{YYYY}', d.getFullYear())
    .replace('{YY}', String(d.getFullYear()).slice(2))
    .replace('{MM}', String(d.getMonth() + 1).padStart(2, '0'));
  return `${prefix}${String(n).padStart(Number(cfg.pad) || 1, '0')}`;
}

const resolveBusiness = (id) => (businessExists(id) ? Number(id) : defaultBusinessId());

export function nextNumber(type, settings = getSettings()) {
  const cfg = settings.numbering[type] || { prefix: '', next: 1, pad: 4 };
  let n = Math.max(Number(cfg.next) || 1, 1);
  const exists = db.prepare('SELECT 1 FROM documents WHERE type = ? AND number = ?');
  while (exists.get(type, renderNumber(cfg, n))) n += 1;
  return { number: renderNumber(cfg, n), sequence: n };
}

/* ---------- input ---------- */

function cleanLines(lines, settings) {
  if (!Array.isArray(lines)) return [];
  return lines.slice(0, 200).map((it) => ({
    name: v.str(it.name, 200),
    description: v.str(it.description, 1000),
    qty: v.num(it.qty ?? 1, { min: -1e6, max: 1e9 }),
    unit: v.str(it.unit, 30),
    rate: v.num(it.rate, { min: -1e12 }),
    tax_rate: v.num(it.tax_rate ?? settings.documents.defaultTaxRate, { min: 0, max: 100 }),
  })).filter((it) => it.name || it.description || it.rate);
}

function cleanRecurring(input, type) {
  if (type !== 'invoice' || !input || !input.enabled) return null;
  return {
    enabled: true,
    interval: v.oneOf(input.interval, INTERVALS, 'monthly'),
    next_date: v.date(input.next_date, { required: true }),
    end_date: v.date(input.end_date),
    auto_send: Boolean(input.auto_send),
    ...(Number.isInteger(input.day) && input.day >= 1 && input.day <= 31 ? { day: input.day } : {}),
  };
}

function cleanDocument(body, settings, existing) {
  const type = existing ? existing.type : v.oneOf(body.type, Object.keys(DOC_TYPES), null);
  if (!type) throw new HttpError(400, 'Unknown document type.');
  const issue = v.date(body.issue_date) || existing?.issue_date || localToday();
  const doc = {
    type,
    format: v.oneOf(body.format, Object.keys(FORMATS), existing?.format || settings.documents.defaultFormat),
    number: v.str(body.number, 60),
    issue_date: issue,
    due_date: DOC_TYPES[type].dateLabel ? v.date(body.due_date) : null,
    currency: v.str(body.currency, 3).toUpperCase() || settings.documents.currency,
    subject: v.str(body.subject, 300),
    reference: v.str(body.reference, 120),
    items: cleanLines(body.items, settings),
    discount_type: v.oneOf(body.discount_type, ['amount', 'percent'], 'amount'),
    discount_value: v.num(body.discount_value, { min: 0 }),
    shipping: v.num(body.shipping, { min: 0 }),
    notes: v.str(body.notes, 4000),
    terms: v.str(body.terms, 4000),
    recurring: cleanRecurring(body.recurring, type),
  };
  if (!/^[A-Z]{3}$/.test(doc.currency)) throw new HttpError(400, 'Currency must be a 3-letter code like INR or USD.');
  return doc;
}

/* ---------- reads ---------- */

export function getDocument(id) {
  const doc = hydrate(db.prepare('SELECT * FROM documents WHERE id = ?').get(id));
  if (!doc) throw new HttpError(404, 'Document not found.');
  return doc;
}

export function getDocumentByToken(token) {
  const doc = hydrate(db.prepare('SELECT * FROM documents WHERE token = ?').get(String(token || '')));
  if (!doc || doc.status === 'draft') throw new HttpError(404, 'This link is not valid any more.');
  return doc;
}

export function getDocumentDetail(id) {
  const doc = getDocument(id);
  doc.payments = db.prepare('SELECT * FROM payments WHERE document_id = ? ORDER BY date DESC, id DESC').all(id);
  doc.activity = db.prepare('SELECT * FROM activity WHERE document_id = ? ORDER BY id DESC LIMIT 100').all(id);
  doc.children = db.prepare('SELECT id, type, number, status FROM documents WHERE parent_id = ? ORDER BY id DESC').all(id);
  return doc;
}

export function listDocuments({ type = '', status = '', q = '', client_id = null, business_id = null } = {}) {
  const like = `%${q}%`;
  const rows = db.prepare(`SELECT id, type, number, token, business_id, client_id, client, status, format, issue_date, due_date,
      currency, subject, total, amount_paid, recurring, claim, sent_at, viewed_at, paid_at, updated_at
    FROM documents
    WHERE (? = '' OR type = ?)
      AND (? IS NULL OR client_id = ?)
      AND (? IS NULL OR business_id = ?)
      AND (? = '' OR number LIKE ? OR client LIKE ? OR subject LIKE ?)
    ORDER BY issue_date DESC, id DESC LIMIT 1000`)
    .all(type, type, client_id, client_id, business_id, business_id, q, like, like, like)
    .map((row) => {
      const doc = hydrate({ ...row, items: '[]' });
      delete doc.items;
      return doc;
    });
  return status ? rows.filter((d) => d.display_status === status) : rows;
}

/* ---------- writes ---------- */

function persistTotals(doc) {
  const totals = computeTotals(doc);
  return { ...doc, items: totals.items, subtotal: totals.subtotal, tax_total: totals.tax_total, total: totals.total };
}

export function createDocument(body, { status } = {}) {
  const businessId = resolveBusiness(body.business_id);
  const settings = settingsFor(businessId);
  const id = transaction(() => {
    const doc = persistTotals(cleanDocument(body, settings, null));
    const generated = nextNumber(doc.type, settings);
    const number = doc.number || generated.number;
    if (db.prepare('SELECT 1 FROM documents WHERE type = ? AND number = ?').get(doc.type, number)) {
      throw new HttpError(409, `${DOC_TYPES[doc.type].label} ${number} already exists.`);
    }
    const client = resolveClient(body.client || {});
    const now = nowIso();
    const paidOnSave = DOC_TYPES[doc.type].paidOnSave;
    const initialStatus = status || (paidOnSave ? 'paid' : 'draft');
    const { lastInsertRowid } = db.prepare(`INSERT INTO documents (
        type, number, token, business_id, client_id, client, status, format, issue_date, due_date, currency, subject, reference,
        items, discount_type, discount_value, shipping, subtotal, tax_total, total, amount_paid, notes, terms,
        recurring, parent_id, paid_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      doc.type, number, newToken(), businessId, client.id, JSON.stringify(client.snapshot), initialStatus, doc.format,
      doc.issue_date, doc.due_date, doc.currency, doc.subject, doc.reference, JSON.stringify(doc.items),
      doc.discount_type, doc.discount_value, doc.shipping, doc.subtotal, doc.tax_total, doc.total,
      initialStatus === 'paid' ? doc.total : 0, doc.notes, doc.terms,
      doc.recurring ? JSON.stringify(doc.recurring) : null, Number(body.parent_id) || null,
      initialStatus === 'paid' ? now : null, now, now,
    );
    if (number === generated.number) {
      saveSettings({ numbering: { [doc.type]: { next: generated.sequence + 1 } } }, businessId);
    }
    rememberItems(doc.items, { countUsage: true });
    const newId = Number(lastInsertRowid);
    logActivity(newId, 'created', `${DOC_TYPES[doc.type].label} ${number} created`);
    return newId;
  });
  emit('document', { id });
  return getDocument(id);
}

export function updateDocument(id, body) {
  const existing = getDocument(id);
  if (existing.status === 'void') throw new HttpError(409, 'Void documents cannot be edited.');
  const businessId = body.business_id === undefined ? existing.business_id : resolveBusiness(body.business_id);
  const settings = settingsFor(businessId);
  transaction(() => {
    const doc = persistTotals(cleanDocument(body, settings, existing));
    const number = doc.number || existing.number;
    if (number !== existing.number
      && db.prepare('SELECT 1 FROM documents WHERE type = ? AND number = ? AND id <> ?').get(doc.type, number, id)) {
      throw new HttpError(409, `${DOC_TYPES[doc.type].label} ${number} already exists.`);
    }
    const client = resolveClient(body.client || {});
    let { status, paid_at: paidAt } = existing;
    let amountPaid = existing.amount_paid;
    if (DOC_TYPES[doc.type].paidOnSave) amountPaid = doc.total;
    if (doc.total > 0 && amountPaid >= doc.total && status !== 'paid') {
      status = 'paid';
      paidAt = paidAt || nowIso();
    } else if (status === 'paid' && amountPaid < doc.total) {
      status = openStatus(existing);
      paidAt = null;
    }
    db.prepare(`UPDATE documents SET number = ?, business_id = ?, client_id = ?, client = ?, status = ?, format = ?, issue_date = ?,
        due_date = ?, currency = ?, subject = ?, reference = ?, items = ?, discount_type = ?, discount_value = ?,
        shipping = ?, subtotal = ?, tax_total = ?, total = ?, amount_paid = ?, notes = ?, terms = ?, recurring = ?,
        paid_at = ?, updated_at = ?
      WHERE id = ?`).run(
      number, businessId, client.id, JSON.stringify(client.snapshot), status, doc.format, doc.issue_date, doc.due_date,
      doc.currency, doc.subject, doc.reference, JSON.stringify(doc.items), doc.discount_type, doc.discount_value,
      doc.shipping, doc.subtotal, doc.tax_total, doc.total, amountPaid, doc.notes, doc.terms,
      doc.recurring ? JSON.stringify(doc.recurring) : null, paidAt, nowIso(), id,
    );
    rememberItems(doc.items, { countUsage: false });
  });
  emit('document', { id });
  return getDocument(id);
}

export function deleteDocument(id) {
  getDocument(id);
  db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  emit('document', { id, deleted: true });
}

export function setStatus(id, status, message) {
  const doc = getDocument(id);
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Unknown status.');
  db.prepare('UPDATE documents SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id);
  logActivity(id, status, message || `Marked as ${status}`);
  emit('document', { id });
  return { ...doc, status };
}

export function markSent(id, message) {
  const doc = getDocument(id);
  if (doc.status === 'void') throw new HttpError(409, 'Void documents cannot be sent.');
  const keep = ['viewed', 'claimed', 'paid', 'accepted', 'declined'].includes(doc.status);
  db.prepare('UPDATE documents SET status = ?, sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ?')
    .run(keep ? doc.status : 'sent', nowIso(), nowIso(), id);
  logActivity(id, 'sent', message);
  emit('document', { id });
  return getDocument(id);
}

export function markViewed(doc) {
  if (doc.viewed_at) return;
  const status = doc.status === 'sent' ? 'viewed' : doc.status;
  db.prepare('UPDATE documents SET viewed_at = ?, status = ? WHERE id = ?').run(nowIso(), status, doc.id);
  logActivity(doc.id, 'viewed', 'Opened by the client for the first time');
  emit('document', { id: doc.id, viewed: true, number: doc.number });
}

/* ---------- payments ---------- */

// Where an unpaid bill sits in its lifecycle.
const openStatus = (doc) => (doc.sent_at ? (doc.viewed_at ? 'viewed' : 'sent') : 'draft');

// Receipts are paid on save and quotations never take money, so only bills get payments.
function getPayable(id) {
  const doc = getDocument(id);
  if (!DOC_TYPES[doc.type].payable) throw new HttpError(400, `A ${DOC_TYPES[doc.type].label.toLowerCase()} does not take payments.`);
  return doc;
}

function syncPaid(id) {
  const doc = getDocument(id);
  const { paid } = db.prepare('SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE document_id = ?').get(id);
  const amountPaid = round2(paid);
  let { status } = doc;
  let paidAt = doc.paid_at;
  // A zero-total bill has no payments to add up, so a manual paid mark stands.
  const settled = doc.total > 0 ? amountPaid >= doc.total : status === 'paid';
  if (settled) {
    status = 'paid';
    paidAt = paidAt || nowIso();
  } else if (status === 'paid' || status === 'claimed') {
    status = openStatus(doc);
    paidAt = null;
  }
  db.prepare('UPDATE documents SET amount_paid = ?, status = ?, paid_at = ?, updated_at = ? WHERE id = ?')
    .run(amountPaid, status, paidAt, nowIso(), id);
  emit('document', { id });
  return getDocumentDetail(id);
}

export function addPayment(id, input) {
  const doc = getPayable(id);
  if (doc.status === 'void') throw new HttpError(409, 'Void documents cannot take payments.');
  const amount = round2(v.num(input.amount, { min: 0 }));
  if (amount <= 0) throw new HttpError(400, 'Enter a payment amount above zero.');
  const method = v.oneOf(input.method, PAYMENT_METHODS, 'Other');
  db.prepare(`INSERT INTO payments (document_id, amount, date, method, reference, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    id, amount, v.date(input.date) || localToday(), method, v.str(input.reference, 120), v.str(input.note, 500), nowIso(),
  );
  logActivity(id, 'payment', `Payment of ${amount} ${doc.currency} recorded (${method})`);
  if (doc.claim) db.prepare('UPDATE documents SET claim = NULL WHERE id = ?').run(id);
  return syncPaid(id);
}

export function markPaid(id, input = {}) {
  const doc = getPayable(id);
  if (doc.status === 'void') throw new HttpError(409, 'Void documents cannot take payments.');
  const balance = round2(doc.total - doc.amount_paid);
  if (balance <= 0) {
    if (doc.status !== 'paid') {
      db.prepare('UPDATE documents SET status = ?, paid_at = COALESCE(paid_at, ?) WHERE id = ?').run('paid', nowIso(), id);
      logActivity(id, 'paid', 'Marked as paid');
    }
    return syncPaid(id);
  }
  return addPayment(id, {
    amount: balance,
    method: input.method || (doc.claim?.method) || 'Bank transfer',
    reference: input.reference || doc.claim?.reference || '',
    date: input.date,
    note: 'Marked as paid',
  });
}

// Undo for "Mark paid": clears every payment and the client's claim so the
// bill goes back to sent, viewed or draft with the full amount due.
export function markUnpaid(id) {
  const doc = getPayable(id);
  if (doc.status !== 'paid' && doc.amount_paid <= 0) throw new HttpError(409, 'This document is not marked as paid.');
  db.prepare('DELETE FROM payments WHERE document_id = ?').run(id);
  db.prepare('UPDATE documents SET claim = NULL, status = ?, paid_at = NULL WHERE id = ?').run(openStatus(doc), id);
  logActivity(id, 'unpaid', 'Marked as unpaid');
  return syncPaid(id);
}

export function deletePayment(paymentId) {
  const row = db.prepare('SELECT document_id FROM payments WHERE id = ?').get(paymentId);
  if (!row) throw new HttpError(404, 'Payment not found.');
  db.prepare('DELETE FROM payments WHERE id = ?').run(paymentId);
  logActivity(row.document_id, 'payment', 'A payment was removed');
  return syncPaid(row.document_id);
}

export function recordClaim(doc, input) {
  if (doc.status === 'paid' || doc.status === 'void') throw new HttpError(409, 'This document is already settled.');
  const claim = {
    method: v.oneOf(input.method, PAYMENT_METHODS, 'Other'),
    reference: v.str(input.reference, 120),
    note: v.str(input.note, 500),
    at: nowIso(),
  };
  db.prepare('UPDATE documents SET claim = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(claim), 'claimed', nowIso(), doc.id);
  logActivity(doc.id, 'claimed', `Client says it is paid${claim.reference ? ` (ref ${claim.reference})` : ''}`);
  emit('document', { id: doc.id, claimed: true, number: doc.number });
}

/* ---------- copies ---------- */

export function copyDocument(id, { type } = {}) {
  const src = getDocument(id);
  const settings = settingsFor(src.business_id);
  const targetType = type && DOC_TYPES[type] ? type : src.type;
  const today = localToday();
  const days = targetType === 'quote' ? settings.documents.quoteValidDays : settings.documents.defaultDueDays;
  const copy = createDocument({
    ...src,
    type: targetType,
    number: '',
    issue_date: today,
    due_date: DOC_TYPES[targetType].dateLabel ? addDays(today, days) : null,
    recurring: null,
    parent_id: type ? src.id : null,
  });
  if (type && type !== src.type) {
    logActivity(src.id, 'converted', `Converted to ${DOC_TYPES[targetType].label} ${copy.number}`);
  }
  return copy;
}

const INTERVAL_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };

// Month steps clamp to the month's last day, so a bill on the 31st lands on
// Feb 28 instead of spilling into March. anchorDay brings it back to the 31st later.
export function nextRecurringDate(iso, interval, anchorDay) {
  if (interval === 'weekly') return addDays(iso, 7);
  const [year, month, day] = iso.split('-').map(Number);
  const target = new Date(year, month - 1 + (INTERVAL_MONTHS[interval] || 1), 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(anchorDay || day, lastDay));
  return target.toLocaleDateString('en-CA');
}

export function setRecurring(id, recurring) {
  db.prepare('UPDATE documents SET recurring = ? WHERE id = ?').run(recurring ? JSON.stringify(recurring) : null, id);
}

export function incrementReminders(id) {
  db.prepare('UPDATE documents SET reminders_sent = reminders_sent + 1 WHERE id = ?').run(id);
}
