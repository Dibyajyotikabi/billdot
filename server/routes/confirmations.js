import { Router } from 'express';
import {
  listConfirmations, getConfirmation, createConfirmation, setShowImage, deleteConfirmation, imagePath,
} from '../repos/confirmations.js';
import { baseUrl } from '../sender.js';
import { HttpError, v } from '../util.js';

export const confirmationsRouter = Router();

const withLink = (row, req) => ({ ...row, link: `${baseUrl(req)}/p/${row.token}` });

confirmationsRouter.get('/', (req, res) => {
  const docId = req.query.document ? v.id(req.query.document) : null;
  res.json(listConfirmations({ document_id: docId }).map((row) => withLink(row, req)));
});
confirmationsRouter.post('/', (req, res) => res.status(201).json(withLink(createConfirmation(req.body || {}), req)));
confirmationsRouter.get('/:id', (req, res) => res.json(withLink(getConfirmation(v.id(req.params.id)), req)));
confirmationsRouter.put('/:id', (req, res) => {
  res.json(withLink(setShowImage(v.id(req.params.id), Boolean(req.body?.show_image)), req));
});
confirmationsRouter.delete('/:id', (req, res) => {
  deleteConfirmation(v.id(req.params.id));
  res.json({ ok: true });
});
confirmationsRouter.get('/:id/image', (req, res) => {
  const file = imagePath(getConfirmation(v.id(req.params.id)));
  if (!file) throw new HttpError(404, 'No screenshot attached.');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(file);
});
