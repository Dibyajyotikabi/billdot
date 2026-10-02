import { parentPort, workerData } from 'node:worker_threads';
import { createWorker } from 'tesseract.js';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parsePaymentText } from '../public/js/shared/payment-text.js';

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
  const fields = Object.assign({}, ...texts.map(parsePaymentText));
  return FIELDS.every((key) => fields[key]);
};

let worker;
let fail;
const failure = new Promise((_, reject) => { fail = reject; });
const work = (async () => {
  worker = await createWorker('eng+hin', 1, {
    langPath: workerData.langPath, gzip: true, cacheMethod: 'none', errorHandler: fail,
  });
  await worker.setParameters({ tessedit_pageseg_mode: '11' });
  const texts = [];
  // The enhanced copy (high contrast, dark themes flipped) only runs when the original misses something.
  for (const image of [workerData.image, workerData.enhanced].filter(Boolean)) {
    if (texts.length && complete(texts)) break;
    const { data } = await worker.recognize(Buffer.from(image));
    texts.push(data.text);
  }
  return texts;
})();
try {
  const texts = await Promise.race([work, failure]);
  const native = complete(texts) ? '' : await nativeText();
  parentPort.postMessage({ texts, native_text: native });
} catch {
  parentPort.postMessage({ error: true });
} finally {
  if (worker) await worker.terminate().catch(() => {});
}
