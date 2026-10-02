import { Router } from 'express';
import QRCode from 'qrcode';
import { db } from '../db.js';
import {
  getSettings, saveSettings, publicSettings, emailConfigured, defaultBusinessId,
} from '../settings.js';
import {
  listBusinesses, createBusiness, setDefaultBusiness, deleteBusiness,
} from '../repos/businesses.js';
import { listClients, getClient, createClient, updateClient, deleteClient } from '../repos/clients.js';
import { listItems, saveItem, deleteItem } from '../repos/items.js';
import { listDocuments } from '../repos/documents.js';
import { dashboard } from '../dashboard.js';
import { subscribe } from '../events.js';
import { sendMail } from '../mailer.js';
import { startTunnel, stopTunnel, tunnelStatus } from '../tunnel.js';
import { baseUrl, PORT } from '../sender.js';
import { asyncH, v, HttpError } from '../util.js';
import { isSetup } from '../auth.js';

export const apiRouter = Router();

apiRouter.get('/events', (req, res) => subscribe(req, res));
apiRouter.get('/dashboard', (req, res) => res.json(dashboard()));

/* settings */
// Settings of the default business, plus every business profile so any
// document can be drawn with the business that issued it.
const settingsPayload = (req) => ({
  ...publicSettings(),
  businesses: listBusinesses(),
  defaultBusinessId: defaultBusinessId(),
  meta: { emailReady: emailConfigured(), baseUrl: baseUrl(req) },
});
apiRouter.get('/settings', (req, res) => res.json(settingsPayload(req)));
apiRouter.put('/settings', (req, res) => {
  saveSettings(req.body || {}, req.query.business ? v.id(req.query.business) : null);
  res.json(settingsPayload(req));
});

/* businesses */
apiRouter.get('/businesses', (req, res) => res.json(listBusinesses()));
apiRouter.post('/businesses', (req, res) => res.status(201).json(createBusiness(req.body || {})));
apiRouter.post('/businesses/:id/default', (req, res) => {
  setDefaultBusiness(v.id(req.params.id));
  res.json({ ok: true });
});
apiRouter.delete('/businesses/:id', (req, res) => {
  deleteBusiness(v.id(req.params.id));
  res.json({ ok: true });
});
apiRouter.post('/settings/test-email', asyncH(async (req, res) => {
  const settings = getSettings();
  const to = v.email(req.body.to || settings.business.email || settings.email.fromEmail, { required: true });
  await sendMail(settings, {
    to,
    subject: 'Test email from your billing app',
    text: 'Your email settings work. Invoices will be delivered from this address.',
  });
  res.json({ ok: true, to });
}));

/* clients */
apiRouter.get('/clients', (req, res) => res.json(listClients({ q: v.str(req.query.q, 100) })));
apiRouter.post('/clients', (req, res) => res.status(201).json(createClient(req.body)));
apiRouter.get('/clients/:id', (req, res) => {
  const id = v.id(req.params.id);
  res.json({ ...getClient(id), documents: listDocuments({ client_id: id }) });
});
apiRouter.put('/clients/:id', (req, res) => res.json(updateClient(v.id(req.params.id), req.body)));
apiRouter.delete('/clients/:id', (req, res) => {
  deleteClient(v.id(req.params.id));
  res.json({ ok: true });
});

/* items */
apiRouter.get('/items', (req, res) => res.json(listItems({ q: v.str(req.query.q, 100) })));
apiRouter.post('/items', (req, res) => res.status(201).json(saveItem(req.body)));
apiRouter.put('/items/:id', (req, res) => res.json(saveItem(req.body, v.id(req.params.id))));
apiRouter.delete('/items/:id', (req, res) => {
  deleteItem(v.id(req.params.id));
  res.json({ ok: true });
});

/* public link */
apiRouter.get('/share', (req, res) => res.json({ ...tunnelStatus(), baseUrl: baseUrl(req) }));
apiRouter.post('/share/start', asyncH(async (req, res) => {
  if (!isSetup()) throw new HttpError(409, 'Set a password before sharing the app.');
  res.json(await startTunnel(PORT));
}));
apiRouter.get('/share/qr.svg', asyncH(async (req, res) => {
  const url = tunnelStatus().url || baseUrl(req);
  const svg = await QRCode.toString(url, { type: 'svg', margin: 0, color: { dark: '#111111', light: '#0000' } });
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-store');
  res.send(svg);
}));
apiRouter.post('/share/stop', (req, res) => res.json(stopTunnel()));

/* backup */
apiRouter.get('/export', (req, res) => {
  const dump = {
    exported_at: new Date().toISOString(),
    settings: publicSettings(),
    businesses: listBusinesses(),
    clients: db.prepare('SELECT * FROM clients').all(),
    items: db.prepare('SELECT * FROM items').all(),
    documents: db.prepare('SELECT * FROM documents').all(),
    payments: db.prepare('SELECT * FROM payments').all(),
  };
  res.setHeader('Content-Disposition', `attachment; filename="billdot-backup-${dump.exported_at.slice(0, 10)}.json"`);
  res.json(dump);
});
