import { parentPort, workerData } from 'node:worker_threads';
import { createWorker } from 'tesseract.js';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { imageSize } from 'image-size';
import { parsePaymentTexts } from '../public/js/shared/payment-text.js';
import {
  AMOUNT_CHECK_CHARS, MAX_AMOUNT_CHECKS, amountWords, checkAmountWord, checkArea, correctedText,
} from './payment-amount-check.js';

// Apple Vision provides a second reading for decorative receipts that confuse OCR.
function nativeText() {
  if (process.platform !== 'darwin') return Promise.resolve('');
  return new Promise((resolve) => {
    const child = execFile('/usr/bin/swift', [fileURLToPath(new URL('./payment-vision.swift', import.meta.url))],
      { timeout: 8000, maxBuffer: 128 * 1024 }, (err, stdout) => {
        if (err) { resolve(''); return; }
        try { resolve(JSON.parse(stdout).text || ''); } catch { resolve(''); }
      });
    child.stdin.on('error', () => {});
    child.stdin.end(Buffer.from(workerData.image));
  });
}

const FIELDS = ['amount', 'reference', 'payer', 'receiver', 'paid_on', 'method'];
const complete = (texts) => {
  const fields = parsePaymentTexts(texts);
  return FIELDS.every((key) => fields[key]);
};

let worker;
let fail;
const failure = new Promise((_, reject) => { fail = reject; });

async function readPasses() {
  worker = await createWorker('eng+hin', 1, {
    langPath: workerData.langPath, gzip: true, cacheMethod: 'none', errorHandler: fail,
  });
  await worker.setParameters({ tessedit_pageseg_mode: '11' });
  const passes = [];
  // The enhanced copy (high contrast, dark themes flipped) only runs when the original misses something.
  for (const image of [workerData.image, workerData.enhanced].filter(Boolean)) {
    if (passes.length && complete(passes.map((pass) => pass.text))) break;
    const bytes = Buffer.from(image);
    const { data } = await worker.recognize(bytes, {}, { text: true, blocks: true });
    const lines = (data.blocks || []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines));
    passes.push({ image: bytes, size: imageSize(bytes), text: data.text, lines });
  }
  return passes;
}

// Re-reads each amount-like word with the Hindi model, which can see the ₹ sign.
async function checkAmounts(passes) {
  const checks = passes.flatMap((pass) => amountWords(pass.lines).map((word) => ({ pass, word })))
    .slice(0, MAX_AMOUNT_CHECKS);
  if (!checks.length) return passes.map((pass) => pass.text);
  await worker.reinitialize('hin');
  await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: AMOUNT_CHECK_CHARS });
  const fixes = new Map();
  for (const { pass, word } of checks) {
    const { data } = await worker.recognize(pass.image, { rectangle: checkArea(word.bbox, pass.size) });
    const fix = checkAmountWord(word.text, data.text.trim());
    if (fix !== null) fixes.set(word, fix);
  }
  return passes.map((pass) => correctedText(pass.lines, fixes) ?? pass.text);
}

try {
  const passes = await Promise.race([readPasses(), failure]);
  let texts;
  let checkError = null;
  try {
    texts = await Promise.race([checkAmounts(passes), failure]);
  } catch (err) {
    // The plain reading is still useful; the server logs why the ₹ check was skipped.
    texts = passes.map((pass) => pass.text);
    checkError = String(err?.message || err);
  }
  const native = complete(texts) ? '' : await nativeText();
  parentPort.postMessage({ texts, native_text: native, check_error: checkError });
} catch {
  parentPort.postMessage({ error: true });
} finally {
  if (worker) await worker.terminate().catch(() => {});
}
