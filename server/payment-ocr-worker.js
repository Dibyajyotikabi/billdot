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

let worker;
let fail;
const failure = new Promise((_, reject) => { fail = reject; });
const work = (async () => {
  worker = await createWorker('eng+hin', 1, {
    langPath: workerData.langPath, gzip: true, cacheMethod: 'none', errorHandler: fail,
  });
  await worker.setParameters({ tessedit_pageseg_mode: '11' });
  const { data } = await worker.recognize(Buffer.from(workerData.image));
  return data.text;
})();
try {
  const text = await Promise.race([work, failure]);
  const fields = parsePaymentText(text);
  const complete = ['amount', 'reference', 'payer', 'receiver', 'paid_on', 'method'].every((key) => fields[key]);
  const native = complete ? '' : await nativeText();
  parentPort.postMessage({ text, native_text: native });
} catch {
  parentPort.postMessage({ error: true });
} finally {
  if (worker) await worker.terminate().catch(() => {});
}
