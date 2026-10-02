import nodemailer from 'nodemailer';
import { DOC_TYPES } from '../public/js/shared/doc-types.js';
import { balanceDue } from '../public/js/shared/calc.js';
import { formatMoney, formatDate, escapeHtml } from '../public/js/shared/format.js';
import { emailConfigured } from './settings.js';
import { HttpError, fillTemplate } from './util.js';

export async function sendMail(settings, message) {
  if (!emailConfigured(settings)) {
    throw new HttpError(400, 'Email is not set up yet. Add your SMTP details in Settings > Email.');
  }
  const { host, port, secure, user, pass, fromName, fromEmail, bcc } = settings.email;
  const transport = nodemailer.createTransport({
    host,
    port: Number(port) || 587,
    secure: Boolean(secure),
    auth: user ? { user, pass } : undefined,
    connectionTimeout: 15000,
  });
  const name = (fromName || settings.business.name || '').replace(/"/g, '');
  try {
    return await transport.sendMail({
      from: name ? `"${name}" <${fromEmail}>` : fromEmail,
      replyTo: settings.business.email || undefined,
      bcc: bcc || undefined,
      ...message,
    });
  } catch (err) {
    throw new HttpError(502, `The mail server refused the message: ${err.message}`);
  }
}

export function templateValues(doc, settings, link) {
  const { currency, locale } = { currency: doc.currency, locale: settings.documents.locale };
  const type = DOC_TYPES[doc.type]?.label || 'Document';
  const due = doc.due_date ? formatDate(doc.due_date, locale) : '';
  return {
    type,
    number: doc.number,
    client: doc.client?.name || 'there',
    business: settings.business.name || 'Our team',
    total: formatMoney(doc.total, currency, locale),
    balance: formatMoney(balanceDue(doc), currency, locale),
    due,
    due_line: due && DOC_TYPES[doc.type]?.payable ? ` It is due on ${due}.` : '',
    link,
  };
}

function htmlBody(text, link, values, settings) {
  const paragraphs = escapeHtml(text.replace(link, '').trim())
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#f2f2ef;padding:32px 12px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
  <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #e3e3df;border-radius:16px">
  <tr><td style="padding:28px 32px 8px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#888">
    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#e8202a;margin-right:8px"></span>${escapeHtml(values.type)} ${escapeHtml(values.number)}
  </td></tr>
  <tr><td style="padding:8px 32px 0;font-size:34px;font-weight:600;letter-spacing:-.02em">${escapeHtml(values.total)}</td></tr>
  <tr><td style="padding:20px 32px 4px;font-size:15px">${paragraphs}</td></tr>
  <tr><td style="padding:0 32px 32px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:13px 22px;border-radius:999px;font-size:14px">View ${escapeHtml(values.type.toLowerCase())}</a></td></tr>
  </table>
  <p style="font-size:12px;color:#999;margin:16px 0 0">${escapeHtml(settings.business.name || '')}</p>
  </td></tr></table></body></html>`;
}

export function buildDocumentEmail(doc, settings, link, { kind = 'send', subject, message } = {}) {
  const values = templateValues(doc, settings, link);
  const tplSubject = subject || (kind === 'reminder' ? settings.email.reminderSubject : settings.email.subject);
  const tplMessage = message || (kind === 'reminder' ? settings.email.reminderMessage : settings.email.message);
  let text = fillTemplate(tplMessage, values);
  if (!text.includes(link)) text += `\n\n${link}`;
  return {
    subject: fillTemplate(tplSubject, values),
    text,
    html: htmlBody(text, link, values, settings),
  };
}
