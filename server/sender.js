import { getSettings, settingsFor, emailConfigured } from './settings.js';
import { buildDocumentEmail, sendMail } from './mailer.js';
import { getDocument, markSent, logActivity, incrementReminders } from './repos/documents.js';
import { DOC_TYPES } from '../public/js/shared/doc-types.js';
import { HttpError, v } from './util.js';

export const PORT = Number(process.env.PORT) || 4321;

// Links in emails must work outside this machine, so the tunnel URL wins.
export function baseUrl(req) {
  const settings = getSettings();
  const fromEnv = process.env.PUBLIC_URL;
  if (settings.sharing.publicUrl) return settings.sharing.publicUrl.replace(/\/$/, '');
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (req) return `${req.protocol}://${req.get('host')}`;
  return `http://localhost:${PORT}`;
}

export const documentLink = (doc, base) => `${base}/d/${doc.token}`;

export async function sendDocument(id, input, base) {
  const doc = getDocument(id);
  const settings = settingsFor(doc.business_id);
  if (doc.status === 'void') throw new HttpError(409, 'Void documents cannot be sent.');
  const to = input.to ? v.emails(input.to) : (doc.client.email ? [doc.client.email] : []);
  if (!to.length) throw new HttpError(400, 'Add the client email address first.');
  const cc = input.cc ? v.emails(input.cc) : [];
  const kind = input.kind === 'reminder' ? 'reminder' : 'send';
  const link = documentLink(doc, base);
  const mail = buildDocumentEmail(doc, settings, link, {
    kind,
    subject: v.str(input.subject, 300),
    message: v.str(input.message, 6000),
  });
  await sendMail(settings, { to: to.join(', '), cc: cc.join(', ') || undefined, ...mail });
  const label = DOC_TYPES[doc.type].label;
  if (kind === 'reminder') {
    incrementReminders(id);
    logActivity(id, 'reminder', `Reminder emailed to ${to.join(', ')}`);
    return getDocument(id);
  }
  return markSent(id, `${label} emailed to ${to.join(', ')}`);
}

export function canAutoSend(doc) {
  return emailConfigured() && Boolean(doc.client?.email);
}
