// Prepares payment screenshots in the browser: a small JPEG to keep as proof,
// plus a high-contrast copy that helps the server read dark-theme receipts.
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.85;
const READ_WIDTH = 1400;
const MAX_READ_PIXELS = 8_000_000;
const MAX_UPLOAD_CHARS = 3_500_000;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject(new Error('Pick an image file, like a PNG or JPG screenshot.')); return; }
    if (file.size > 20 * 1024 * 1024) { reject(new Error('Pick a screenshot smaller than 20 MB.')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image could not be read.')); };
    img.src = url;
  });
}

function draw(img, scale) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

// The darkest channel turns white-on-colour text (like a green date pill) into strong contrast.
// Dark themes are flipped so the reader always sees dark text on a light page.
function enhancedCopy(img) {
  const scale = Math.min(3, Math.max(1, READ_WIDTH / img.width), Math.sqrt(MAX_READ_PIXELS / (img.width * img.height)));
  const { canvas, ctx } = draw(img, scale);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = frame.data;
  let total = 0;
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.min(px[i], px[i + 1], px[i + 2]);
    px[i] = v;
    total += v;
  }
  const dark = total / (px.length / 4) < 128;
  for (let i = 0; i < px.length; i += 4) {
    const v = dark ? 255 - px[i] : px[i];
    px[i] = v; px[i + 1] = v; px[i + 2] = v;
  }
  ctx.putImageData(frame, 0, 0);
  const url = canvas.toDataURL('image/jpeg', 0.9);
  return url.length < MAX_UPLOAD_CHARS ? url : null;
}

// Screenshots are often 3-5 MB PNGs. A 1600px JPEG keeps the UTR readable at a fraction of the size.
export async function readScreenshot(file) {
  const img = await loadImage(file);
  if (img.width * img.height > 16_000_000) throw new Error('Use a screenshot smaller than 16 megapixels.');
  try {
    const { canvas } = draw(img, Math.min(1, MAX_SIDE / Math.max(img.width, img.height)));
    let enhanced = null;
    try { enhanced = enhancedCopy(img); } catch { enhanced = null; }
    return { image: canvas.toDataURL('image/jpeg', JPEG_QUALITY), enhanced };
  } catch {
    throw new Error('That image could not be prepared. Use a smaller PNG or JPG screenshot.');
  }
}
