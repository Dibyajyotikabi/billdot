import { Router } from 'express';
import { getDocumentByToken, markViewed, recordClaim, setStatus } from '../repos/documents.js';
import { getConfirmationByToken, imagePath } from '../repos/confirmations.js';
import { clientFacingSettings, settingsFor } from '../settings.js';
import { sendUpiSvg } from '../upi.js';
import { hasSession, rateLimit } from '../auth.js';
import { DOC_TYPES } from '../../public/js/shared/doc-types.js';
import { asyncH, HttpError, v } from '../util.js';

export const publicRouter = Router();
const writeLimiter = rateLimit({ limit: 20, windowMs: 60 * 60 * 1000 });

// Payment confirmation page. Internal ids and the stored file name stay private.
publicRouter.get('/c/:token', (req, res) => {
  const c = getConfirmationByToken(req.params.token);
  const showDoc = c.document_token && c.document_status !== 'draft';
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    confirmation: {
      amount: c.amount, currency: c.currency, payer: c.payer, method: c.method, reference: c.reference,
      paid_on: c.paid_on, note: c.note, created_at: c.created_at, has_image: c.show_image && c.has_image,
      document: showDoc ? { number: c.document_number, type: c.document_type, token: c.document_token } : null,
    },
    settings: clientFacingSettings(settingsFor(c.business_id)),
    isOwner: hasSession(req),
  });
});

publicRouter.get('/c/:token/image', (req, res) => {
  const c = getConfirmationByToken(req.params.token);
  if (!c.show_image) throw new HttpError(404, 'No screenshot on this page.');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(imagePath(c));
});

function clientView(doc) {
  const { client_id, parent_id, recurring, reminders_sent, business_id, ...rest } = doc;
  return rest;
}

publicRouter.get('/:token', (req, res) => {
  const doc = getDocumentByToken(req.params.token);
  const isOwner = hasSession(req);
  if (!isOwner) markViewed(doc);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ document: clientView(doc), settings: clientFacingSettings(settingsFor(doc.business_id)), isOwner });
});

publicRouter.post('/:token/claim', writeLimiter, (req, res) => {
  const doc = getDocumentByToken(req.params.token);
  if (!DOC_TYPES[doc.type].payable) throw new HttpError(400, 'Nothing to pay on this document.');
  recordClaim(doc, req.body || {});
  res.json({ ok: true });
});

publicRouter.post('/:token/respond', writeLimiter, (req, res) => {
  const doc = getDocumentByToken(req.params.token);
  if (!DOC_TYPES[doc.type].respondable) throw new HttpError(400, 'This document does not need a response.');
  if (['accepted', 'declined', 'void'].includes(doc.status)) throw new HttpError(409, 'This quotation already has a response.');
  const action = v.oneOf(req.body.action, ['accepted', 'declined'], null);
  if (!action) throw new HttpError(400, 'Choose accept or decline.');
  const name = v.str(req.body.name, 120);
  setStatus(doc.id, action, `Client ${action} the quotation${name ? ` (${name})` : ''}`);
  res.json({ ok: true });
});

publicRouter.get('/:token/upi.svg', asyncH(async (req, res) => {
  await sendUpiSvg(getDocumentByToken(req.params.token), res);
}));
