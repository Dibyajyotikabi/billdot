// Draws the "payment received" post as a 1080x1350 PNG (Instagram portrait size)
// so it can be downloaded or shared straight to WhatsApp.
import { formatMoney, formatDate } from './format.js';

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

async function loadFonts() {
  if (!document.fonts?.load) return;
  await Promise.all([
    document.fonts.load('900 120px Doto'),
    document.fonts.load('400 28px "Space Mono"'),
    document.fonts.load('700 28px "Space Mono"'),
    document.fonts.load('500 40px "Space Grotesk"'),
    document.fonts.load('600 40px "Space Grotesk"'),
  ]).catch(() => {});
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
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

function dotGrid(ctx) {
  ctx.fillStyle = C.dot;
  for (let y = 18; y < H; y += 27) {
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

function drawCheck(ctx, x, y, cell) {
  CHECK.forEach((row, r) => [...row].forEach((on, c) => {
    const cx = x + c * cell + cell / 2;
    const cy = y + r * cell + cell / 2;
    if (on === '1') led(ctx, cx, cy, cell * 0.36, C.green);
    else {
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }));
}

function dottedRule(ctx, y) {
  ctx.fillStyle = C.line;
  for (let x = PAD; x < W - PAD; x += 12) ctx.fillRect(x, y, 5, 2);
}

/**
 * @param {{confirmation: object, business: object, locale?: string}} input
 * @returns {Promise<Blob>}
 */
export async function drawProofCard({ confirmation: c, business = {}, locale = 'en-IN' }) {
  await loadFonts();
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  dotGrid(ctx);

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
  ctx.fillStyle = C.ink;
  ctx.font = '600 38px "Space Grotesk", sans-serif';
  ctx.fillText(clip(ctx, business.name || 'Payment', W - nameX - PAD - 40), nameX, 137);
  led(ctx, W - PAD - 8, 124, 9, C.red);

  // Label
  led(ctx, PAD + 10, 300, 10, C.green);
  ctx.fillStyle = C.green;
  ctx.font = '700 30px "Space Mono", monospace';
  ctx.letterSpacing = '6px';
  ctx.fillText('PAYMENT RECEIVED', PAD + 40, 311);
  ctx.letterSpacing = '0px';

  // Amount in dot-matrix type
  const amount = formatMoney(c.amount, c.currency, locale);
  const size = fitText(ctx, amount, (s) => `900 ${s}px Doto, monospace`, 190, W - PAD * 2);
  ctx.fillStyle = C.ink;
  ctx.fillText(amount, PAD - 6, 330 + size * 0.95);
  let y = 330 + size * 0.95 + 74;

  if (c.payer) {
    ctx.fillStyle = C.muted;
    ctx.font = '500 40px "Space Grotesk", sans-serif';
    ctx.fillText(clip(ctx, `from ${c.payer}`, W - PAD * 2), PAD, y);
    y += 40;
  }

  // Detail rows
  y = Math.max(y + 50, 760);
  dottedRule(ctx, y);
  const rows = [
    ['DATE', formatDate(c.paid_on, locale)],
    ['METHOD', c.method],
    c.reference && ['UTR / REF', c.reference],
    c.document?.number && ['FOR', c.document.number],
  ].filter(Boolean);
  for (const [label, value] of rows) {
    y += 74;
    ctx.fillStyle = C.muted;
    ctx.font = '400 26px "Space Mono", monospace';
    ctx.letterSpacing = '3px';
    ctx.fillText(label, PAD, y);
    ctx.letterSpacing = '0px';
    ctx.fillStyle = C.ink;
    ctx.font = '700 32px "Space Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(clip(ctx, String(value), W - PAD * 2 - 260), W - PAD, y);
    ctx.textAlign = 'left';
  }
  dottedRule(ctx, y + 40);

  // Footer: big dot check and thank you
  drawCheck(ctx, PAD - 4, H - 250, 26);
  ctx.fillStyle = C.ink;
  ctx.font = '600 44px "Space Grotesk", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('Thank you', W - PAD, H - 140);
  ctx.fillStyle = C.muted;
  ctx.font = '400 24px "Space Mono", monospace';
  ctx.fillText(clip(ctx, [business.website, business.phone].filter(Boolean).join('  ') || ' ', 620), W - PAD, H - 96);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the image.'))), 'image/png');
  });
}

export const proofFileName = (c) => `payment-${String(c.reference || c.paid_on || 'received').replace(/[^\w-]+/g, '')}.png`;

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
    await navigator.share({ files: [file], text, url }).catch(() => {});
    return 'shared';
  }
  await downloadProofCard(input);
  return 'downloaded';
}
