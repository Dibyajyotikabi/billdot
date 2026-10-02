import QRCode from 'qrcode';
import { settingsFor } from './settings.js';
import { DOC_TYPES } from '../public/js/shared/doc-types.js';
import { balanceDue } from '../public/js/shared/calc.js';
import { HttpError } from './util.js';

// UPI QR code with the balance pre-filled, for Indian payment apps.
export async function sendUpiSvg(doc, res) {
  const { payment, business } = settingsFor(doc.business_id);
  if (!payment.upiId || doc.currency !== 'INR') throw new HttpError(404, 'UPI is not set up.');
  const params = new URLSearchParams({
    pa: payment.upiId,
    pn: business.name || payment.accountName || 'Payee',
    am: balanceDue(doc).toFixed(2),
    cu: 'INR',
    tn: `${DOC_TYPES[doc.type].label} ${doc.number}`,
  });
  const svg = await QRCode.toString(`upi://pay?${params}`, { type: 'svg', margin: 0, color: { dark: '#111111', light: '#0000' } });
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-store');
  res.send(svg);
}
