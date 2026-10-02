import { Router } from 'express';
import {
  listDocuments, getDocumentDetail, createDocument, updateDocument, deleteDocument, nextNumber,
  addPayment, deletePayment, markPaid, markUnpaid, setStatus, copyDocument, markSent,
} from '../repos/documents.js';
import { sendDocument, baseUrl, documentLink } from '../sender.js';
import { settingsFor } from '../settings.js';
import { buildDocumentEmail } from '../mailer.js';
import { DOC_TYPES } from '../../public/js/shared/doc-types.js';
import { asyncH, v, HttpError } from '../util.js';
import { sendUpiSvg } from '../upi.js';
import { getDocument } from '../repos/documents.js';

export const documentsRouter = Router();

const withLink = (doc, req) => ({ ...doc, link: documentLink(doc, baseUrl(req)) });

documentsRouter.get('/', (req, res) => {
  res.json(listDocuments({
    type: v.str(req.query.type, 20),
    status: v.str(req.query.status, 20),
    q: v.str(req.query.q, 100),
    business_id: req.query.business ? v.id(req.query.business) : null,
  }));
});

documentsRouter.get('/next-number', (req, res) => {
  const type = v.oneOf(req.query.type, Object.keys(DOC_TYPES), 'invoice');
  res.json({ number: nextNumber(type, settingsFor(req.query.business)).number });
});

documentsRouter.post('/', (req, res) => res.status(201).json(withLink(createDocument(req.body), req)));

documentsRouter.get('/:id/upi.svg', asyncH(async (req, res) => {
  await sendUpiSvg(getDocument(v.id(req.params.id)), res);
}));

documentsRouter.get('/:id', (req, res) => res.json(withLink(getDocumentDetail(v.id(req.params.id)), req)));

documentsRouter.put('/:id', (req, res) => res.json(withLink(updateDocument(v.id(req.params.id), req.body), req)));

documentsRouter.delete('/:id', (req, res) => {
  deleteDocument(v.id(req.params.id));
  res.json({ ok: true });
});

// Preview of the email so the person can edit it before sending.
documentsRouter.get('/:id/email', (req, res) => {
  const doc = getDocumentDetail(v.id(req.params.id));
  const kind = req.query.kind === 'reminder' ? 'reminder' : 'send';
  const link = documentLink(doc, baseUrl(req));
  const mail = buildDocumentEmail(doc, settingsFor(doc.business_id), link, { kind });
  res.json({ to: doc.client.email || '', subject: mail.subject, message: mail.text, link });
});

documentsRouter.post('/:id/send', asyncH(async (req, res) => {
  const doc = await sendDocument(v.id(req.params.id), req.body || {}, baseUrl(req));
  res.json(withLink(doc, req));
}));

// For sharing by WhatsApp or a copied link, where no email goes out.
documentsRouter.post('/:id/shared', (req, res) => {
  const channel = v.str(req.body.channel, 30) || 'link';
  res.json(withLink(markSent(v.id(req.params.id), `Shared by ${channel}`), req));
});

documentsRouter.post('/:id/payments', (req, res) => res.json(addPayment(v.id(req.params.id), req.body || {})));
documentsRouter.delete('/payments/:paymentId', (req, res) => res.json(deletePayment(v.id(req.params.paymentId))));
documentsRouter.post('/:id/paid', (req, res) => res.json(markPaid(v.id(req.params.id), req.body || {})));
documentsRouter.post('/:id/unpaid', (req, res) => res.json(markUnpaid(v.id(req.params.id))));

documentsRouter.post('/:id/status', (req, res) => {
  const status = v.str(req.body.status, 20);
  if (!['void', 'accepted', 'declined', 'sent', 'draft'].includes(status)) throw new HttpError(400, 'Unknown status.');
  res.json(setStatus(v.id(req.params.id), status));
});

documentsRouter.post('/:id/copy', (req, res) => {
  const type = req.body.type ? v.oneOf(req.body.type, Object.keys(DOC_TYPES), null) : null;
  res.status(201).json(copyDocument(v.id(req.params.id), { type }));
});
