// Draws a 1080x1350 receipt, extending it with the selected payment screenshot,
// so it can be downloaded or shared straight to WhatsApp.
import { formatMoney, formatDate } from './format.js';
import { visibleProof, proofLabel, proofParties, proofDirection, proofIconStyle } from './proof-details.js';
import { fontTheme } from './appearance.js';

const W = 1080;
const H = 1350;
const PAD = 84;
const C = {
  bg: '#0a0a0a', dot: '#1d1d1d', ink: '#f1f1ed', muted: '#8b8b85', line: '#2a2a2a', green: '#4cc38a', red: '#d71921',
};

// 7x5 dot-matrix check mark, drawn as LED dots.
export const CHECK = [
  '000000001',
  '000000011',
  '000000110',
  '100001100',
  '110011000',
  '011110000',
  '001100000',
];

async function loadFonts(fonts) {
  if (!document.fonts?.load) return;
  await Promise.all([
    document.fonts.load(`900 120px ${fonts.display}`),
    document.fonts.load(`400 28px ${fonts.detail}`),
    document.fonts.load(`700 28px ${fonts.detail}`),
    document.fonts.load(`500 40px ${fonts.body}`),
    document.fonts.load(`600 40px ${fonts.body}`),
  ]).catch(() => {});
}

function loadImage(src, required = false) {
  return new Promise((resolve, reject) => {
    if (!src) { resolve(null); return; }
    const img = new Image();
    const failed = () => {
      clearTimeout(timer);
      if (required) reject(new Error('Could not load the attached screenshot. Try saving the image again.'));
      else resolve(null);
    };
    const timer = setTimeout(failed, 10_000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = failed;
    img.src = src;
  });
}

// Shrinks the font until the text fits the width.
function fitText(ctx, text, font, size, maxWidth, minSize = 40) {
  let s = size;
  ctx.font = font(s);
  while (ctx.measureText(text).width > maxWidth && s > minSize) {
    s -= 4;
    ctx.font = font(s);
  }
  return s;
}

function clip(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}...`).width > maxWidth) out = out.slice(0, -1);
  return `${out.trimEnd()}...`;
}

function dotGrid(ctx, height = H) {
  ctx.fillStyle = C.dot;
  for (let y = 18; y < height; y += 27) {
    for (let x = 18; x < W; x += 27) {
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function led(ctx, x, y, r, color) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = r * 2.4;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCheck(ctx, x, y, cell, colors = C, minimal = false) {
  CHECK.forEach((row, r) => [...row].forEach((on, c) => {
    const cx = x + c * cell + cell / 2;
    const cy = y + r * cell + cell / 2;
    if (on === '1' && !minimal) led(ctx, cx, cy, cell * 0.36, colors.green);
    else {
      ctx.fillStyle = on === '1' ? colors.green : colors.dot;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }));
}

function dottedRule(ctx, y, colors = C, minimal = false) {
  ctx.fillStyle = colors.line;
  if (minimal) { ctx.fillRect(PAD, y, W - PAD * 2, 1); return; }
  for (let x = PAD; x < W - PAD; x += 12) ctx.fillRect(x, y, 5, 2);
}

function drawProofIcon(ctx, c, y, colors, minimal) {
  const style = proofIconStyle(c.icon_style);
  if (style === 'dots') { drawCheck(ctx, PAD - 4, y, 24, colors, minimal); return; }
  ctx.save();
  ctx.translate(PAD, y);
  ctx.scale(7, 7);
  ctx.strokeStyle = colors.green;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (style === 'seal') { ctx.beginPath(); ctx.arc(12, 12, 10, 0, Math.PI * 2); ctx.stroke(); }
  ctx.beginPath();
  if (style === 'arrow' && proofDirection(c) === 'sent') {
    ctx.moveTo(7, 17); ctx.lineTo(17, 7); ctx.moveTo(7, 7); ctx.lineTo(17, 7); ctx.lineTo(17, 17);
  } else if (style === 'arrow') {
    ctx.moveTo(17, 7); ctx.lineTo(7, 17); ctx.moveTo(7, 7); ctx.lineTo(7, 17); ctx.lineTo(17, 17);
  } else { ctx.moveTo(6, 12); ctx.lineTo(10, 16); ctx.lineTo(18, 8); }
  ctx.stroke();
  ctx.restore();
}

/**
 * @param {{confirmation: object, business: object, locale?: string}} input
 * @returns {Promise<Blob>}
 */
export async function drawProofCard({ confirmation: c, business = {}, locale = 'en-IN', font = 'original', style = 'billdot' }) {
  c = visibleProof(c);
  const minimal = style === 'notion';
  const colors = minimal ? { ...C, bg: '#fff', ink: '#37352f', muted: '#787774', line: '#e9e9e7', dot: '#e9e9e7', green: '#37352f' } : C;
  const fonts = fontTheme(minimal && font === 'original' ? 'system' : font);
  await loadFonts(fonts);
  const screenshot = await loadImage(c.image_src, true);
  const receiptHeight = H + (c.note ? 140 : 0);
  const shotHeight = screenshot ? Math.min(2400, Math.round((W - PAD * 2) * screenshot.height / screenshot.width)) : 0;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = receiptHeight + (screenshot ? shotHeight + 190 : 0);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, W, canvas.height);
  if (!minimal) dotGrid(ctx, receiptHeight);

  // Header: logo or LED, business name, small red dot like a recording light.
  const logo = await loadImage(business.logo);
  let nameX = PAD;
  if (logo) {
    const h = 56;
    const w = Math.min(200, (logo.width / logo.height) * h);
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(PAD - 10, 86, w + 20, h + 20, 12);
    ctx.fill();
    ctx.restore();
    ctx.drawImage(logo, PAD, 96, w, h);
    nameX = PAD + w + 34;
  }
  ctx.fillStyle = colors.ink;
  ctx.font = `600 38px ${fonts.body}`;
  ctx.fillText(clip(ctx, business.name || 'Payment', W - nameX - PAD - 40), nameX, 137);
  if (!minimal) led(ctx, W - PAD - 8, 124, 9, colors.red);

  // Label
  if (!minimal) led(ctx, PAD + 10, 300, 10, colors.green);
  ctx.fillStyle = colors.green;
  ctx.font = `700 30px ${fonts.detail}`;
  ctx.letterSpacing = minimal ? '0px' : '6px';
  ctx.fillText(minimal ? proofLabel(c) : proofLabel(c).toUpperCase(), minimal ? PAD : PAD + 40, 311);
  ctx.letterSpacing = '0px';

  // Amount in dot-matrix type
  const amount = formatMoney(c.amount, c.currency, locale);
  const size = fitText(ctx, amount, (s) => `${minimal ? 600 : 900} ${s}px ${fonts.display}`, minimal ? 120 : 190, W - PAD * 2);
  ctx.fillStyle = colors.ink;
  if (c.amount !== undefined) ctx.fillText(amount, PAD - 6, 330 + size * 0.95);
  let y = 330 + size * 0.95 + 74;

  for (const [prefix, name] of proofParties(c).filter(([, name]) => name)) {
    ctx.fillStyle = colors.muted;
    ctx.font = `500 40px ${fonts.body}`;
    ctx.fillText(clip(ctx, `${prefix} ${name}`, W - PAD * 2), PAD, y);
    y += 48;
  }

  // Detail rows
  y = Math.max(y + 50, 760);
  dottedRule(ctx, y, colors, minimal);
  const rows = [
    c.paid_on && ['DATE', formatDate(c.paid_on, locale)],
    c.method && ['METHOD', c.method],
    c.reference && ['UTR / REF', c.reference],
    c.document?.number && ['FOR', c.document.number],
  ].filter(Boolean);
  for (const [label, value] of rows) {
    y += 74;
    ctx.fillStyle = colors.muted;
    ctx.font = `400 26px ${fonts.detail}`;
    ctx.letterSpacing = minimal ? '0px' : '3px';
    ctx.fillText(minimal ? label.charAt(0) + label.slice(1).toLowerCase() : label, PAD, y);
    ctx.letterSpacing = '0px';
    ctx.fillStyle = colors.ink;
    ctx.font = `700 32px ${fonts.detail}`;
    ctx.textAlign = 'right';
    ctx.fillText(clip(ctx, String(value), W - PAD * 2 - 260), W - PAD, y);
    ctx.textAlign = 'left';
  }
  dottedRule(ctx, y + 40, colors, minimal);
  if (c.note) {
    ctx.fillStyle = colors.muted;
    ctx.font = `400 26px ${fonts.body}`;
    ctx.fillText(clip(ctx, c.note, W - PAD * 2), PAD, y + 86);
  }

  // Footer: big dot check and thank you
  drawProofIcon(ctx, c, receiptHeight - 240, colors, minimal);
  ctx.fillStyle = colors.ink;
  ctx.font = `600 ${minimal ? 32 : 40}px ${fonts.body}`;
  ctx.textAlign = 'right';
  ctx.fillText(proofDirection(c) === 'sent' ? 'Payment confirmation' : 'Thank you', W - PAD, receiptHeight - 140);
  ctx.fillStyle = colors.muted;
  ctx.font = `400 24px ${fonts.detail}`;
  ctx.fillText(clip(ctx, [business.website, business.phone].filter(Boolean).join('  ') || ' ', 620), W - PAD, receiptHeight - 96);
  ctx.textAlign = 'left';

  if (screenshot) {
    dottedRule(ctx, receiptHeight - 12, colors, minimal);
    ctx.fillStyle = colors.green;
    ctx.font = `700 26px ${fonts.detail}`;
    ctx.fillText('PAYMENT EVIDENCE', PAD, receiptHeight + 58);
    const scale = Math.min((W - PAD * 2) / screenshot.width, shotHeight / screenshot.height);
    const width = screenshot.width * scale;
    const height = screenshot.height * scale;
    const x = (W - width) / 2;
    const y = receiptHeight + 100;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 16);
    ctx.clip();
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, width, height);
    ctx.drawImage(screenshot, x, y, width, height);
    ctx.restore();
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the image.'))), 'image/png');
  });
}

export const proofFileName = (c) => {
  c = visibleProof(c);
  return `payment-${String(c.reference || c.paid_on || 'received').replace(/[^\w-]+/g, '')}.png`;
};

export async function downloadProofCard(input) {
  const blob = await drawProofCard(input);
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: proofFileName(input.confirmation) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Shares the image file where the browser supports it (phones), else downloads it.
export async function shareProofCard(input, { text = '', url = '' } = {}) {
  const blob = await drawProofCard(input);
  const file = new File([blob], proofFileName(input.confirmation), { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], text, url });
    return 'shared';
  }
  await downloadProofCard(input);
  return 'downloaded';
}
