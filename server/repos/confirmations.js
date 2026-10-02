// Payment confirmations: a shareable sent/received payment page built from a
// UPI screenshot or typed details, optionally tied to an invoice.
import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR, transaction } from '../db.js';
import { businessExists, defaultBusinessId, settingsFor } from '../settings.js';
import { addPayment, getDocument } from './documents.js';
import { emit } from '../events.js';
import { PAYMENT_METHODS } from '../../public/js/shared/doc-types.js';
import { localToday } from '../../public/js/shared/format.js';
import { round2 } from '../../public/js/shared/calc.js';
import { HttpError, newToken, nowIso, v } from '../util.js';
import { proofVisibility, proofIconStyle } from '../../public/js/shared/proof-details.js';

export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = {
  jpeg: { ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  png: { ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] },
  webp: { ext: 'webp', magic: [0x52, 0x49, 0x46, 0x46] },
};

// Accepts a data URL, checks the bytes really are that image type, writes it to disk.
function saveImage(dataUrl, token) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) throw new HttpError(400, 'The screenshot must be a JPG, PNG or WebP image.');
  const type = IMAGE_TYPES[match[1]];
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'The screenshot is too large. Keep it under 4 MB.');
  if (!type.magic.every((b, i) => bytes[i] === b)) throw new HttpError(400, 'That file is not a valid image.');
  const name = `${token}.${type.ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), bytes);
  return name;
}

export function imagePath(row) {
  return row?.image ? path.join(UPLOAD_DIR, path.basename(row.image)) : null;
}

const hydrate = (row) => {
  if (!row) return null;
  let visibility;
  try { visibility = JSON.parse(row.visibility); } catch { visibility = {}; }
  return { ...row, visibility: proofVisibility(visibility), show_image: Boolean(row.show_image), has_image: Boolean(row.image) };
};

const SELECT = `SELECT c.*, d.number AS document_number, d.type AS document_type, d.token AS document_token,
    d.status AS document_status
  FROM confirmations c LEFT JOIN documents d ON d.id = c.document_id`;

export function listConfirmations({ document_id = null } = {}) {
  return db.prepare(`${SELECT} WHERE (? IS NULL OR c.document_id = ?) ORDER BY c.paid_on DESC, c.id DESC LIMIT 500`)
    .all(document_id, document_id).map(hydrate);
}

export function getConfirmation(id) {
  const row = hydrate(db.prepare(`${SELECT} WHERE c.id = ?`).get(id));
  if (!row) throw new HttpError(404, 'Confirmation not found.');
  return row;
}

export function getConfirmationByToken(token) {
  const row = hydrate(db.prepare(`${SELECT} WHERE c.token = ?`).get(String(token || '')));
  if (!row) throw new HttpError(404, 'This link is not valid any more.');
  return row;
}

export function createConfirmation(input = {}) {
  const doc = input.document_id ? getDocument(v.id(input.document_id)) : null;
  const businessId = doc?.business_id
    || (businessExists(input.business_id) ? Number(input.business_id) : defaultBusinessId());
  const settings = settingsFor(businessId);
  const direction = v.oneOf(input.direction, ['sent', 'received'], 'sent');
  if (direction === 'sent' && input.record_payment) throw new HttpError(400, 'Sent payments cannot reduce a bill’s receivable balance. Choose Payment received to record an incoming payment.');
  const amount = round2(v.num(input.amount, { min: 0 }));
  if (amount <= 0) throw new HttpError(400, 'Enter the amount that was paid.');
  const currency = (v.str(input.currency, 3).toUpperCase() || doc?.currency || settings.documents.currency);
  if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'Currency must be a 3-letter code like INR.');
  const row = {
    token: newToken(),
    payer: v.str(input.payer, 160) || (direction === 'sent' ? settings.business.name : doc?.client?.name) || '',
    receiver: v.str(input.receiver, 160) || (direction === 'sent' ? doc?.client?.name : settings.business.name) || '',
    direction, icon_style: proofIconStyle(input.icon_style || settings.appearance.proofIcon),
    method: v.oneOf(input.method, PAYMENT_METHODS, 'UPI'),
    reference: v.str(input.reference, 120),
    paid_on: v.date(input.paid_on) || localToday(),
    note: v.str(input.note, 500),
  };
  const image = input.image ? saveImage(input.image, row.token) : null;

  let id;
  try {
    id = transaction(() => {
      let paymentId = null;
      if (doc && input.record_payment) {
        addPayment(doc.id, {
          amount, method: row.method, reference: row.reference, date: row.paid_on, note: 'From payment confirmation',
        });
        paymentId = db.prepare('SELECT id FROM payments WHERE document_id = ? ORDER BY id DESC LIMIT 1').get(doc.id)?.id ?? null;
      }
      const { lastInsertRowid } = db.prepare(`INSERT INTO confirmations (token, business_id, document_id, payment_id, amount,
          currency, payer, receiver, direction, icon_style, method, reference, paid_on, note, image, show_image, visibility, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        row.token, businessId, doc?.id ?? null, paymentId, amount, currency, row.payer, row.receiver, row.direction, row.icon_style, row.method, row.reference,
        row.paid_on, row.note, image, input.show_image && image ? 1 : 0, JSON.stringify(proofVisibility(input.visibility)), nowIso(),
      );
      return Number(lastInsertRowid);
    });
  } catch (err) {
    // A refused payment (void bill, quotation) must not leave the screenshot behind.
    if (image) fs.rmSync(path.join(UPLOAD_DIR, image), { force: true });
    throw err;
  }
  emit('confirmation', { id });
  return getConfirmation(id);
}

export function setShowImage(id, show) {
  return updateConfirmation(id, { show_image: show });
}

export function updateConfirmation(id, patch = {}) {
  const row = getConfirmation(id);
  const show = Object.hasOwn(patch, 'show_image') ? Boolean(patch.show_image) : row.show_image;
  const visibility = proofVisibility({ ...row.visibility, ...patch.visibility });
  const direction = v.oneOf(patch.direction, ['sent', 'received'], row.direction);
  if (row.payment_id && direction !== 'received') throw new HttpError(409, 'This proof recorded an incoming bill payment. Create a separate proof for a sent payment.');
  const icon = Object.hasOwn(patch, 'icon_style') ? proofIconStyle(patch.icon_style) : row.icon_style;
  db.prepare('UPDATE confirmations SET show_image = ?, visibility = ?, direction = ?, icon_style = ? WHERE id = ?')
    .run(show && row.image ? 1 : 0, JSON.stringify(visibility), direction, icon, id);
  emit('confirmation', { id });
  return getConfirmation(id);
}

// The recorded payment stays on the invoice; remove it there if it was wrong.
export function deleteConfirmation(id) {
  const row = getConfirmation(id);
  const file = imagePath(row);
  db.prepare('DELETE FROM confirmations WHERE id = ?').run(id);
  if (file) fs.rm(file, { force: true }, () => {});
  emit('confirmation', { id, deleted: true });
}
