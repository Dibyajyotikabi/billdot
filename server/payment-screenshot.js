import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import english from '@tesseract.js-data/eng';
import hindi from '@tesseract.js-data/hin';
import { imageSize } from 'image-size';
import { HttpError } from './util.js';
import { parsePaymentText } from '../public/js/shared/payment-text.js';

export function decodeScreenshot(dataUrl) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) throw new HttpError(400, 'The screenshot must be a JPG, PNG or WebP image.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 4 * 1024 * 1024) throw new HttpError(413, 'The screenshot is too large. Keep it under 4 MB.');
  let size;
  try { size = imageSize(bytes); } catch { throw new HttpError(400, 'That file is not a valid image.'); }
  if (size.type !== (match[1] === 'jpeg' ? 'jpg' : match[1])) throw new HttpError(400, 'That file is not a valid image.');
  if (!size.width || !size.height || size.width * size.height > 16_000_000) {
    throw new HttpError(413, 'Use a screenshot smaller than 16 megapixels.');
  }
  return bytes;
}

let busy = false;

// Bundled language data keeps payment screenshots on this computer, even offline.
export async function extractPaymentScreenshot(dataUrl) {
  const bytes = decodeScreenshot(dataUrl);
  if (busy) throw new HttpError(429, 'Another screenshot is being read. Try again in a moment.');
  busy = true;
  let worker;
  let timer;
  let languageDir;
  try {
    languageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'billdot-ocr-'));
    for (const language of [english, hindi]) {
      fs.copyFileSync(path.join(language.langPath, `${language.code}.traineddata.gz`), path.join(languageDir, `${language.code}.traineddata.gz`));
    }
    // Terminating this thread also stops OCR during initialization or recognition.
    worker = new Worker(new URL('./payment-ocr-worker.js', import.meta.url), { workerData: { image: bytes, langPath: languageDir } });
    const result = await new Promise((resolve, reject) => {
      const failed = () => reject(new HttpError(422, 'Could not read this screenshot. Try a clearer image or enter the details.'));
      worker.once('message', (message) => message.error ? failed() : resolve(message));
      worker.once('error', failed);
      worker.once('exit', failed);
      timer = setTimeout(() => reject(new HttpError(408, 'Reading took too long. Try again or enter the details.')), 30_000);
    });
    return { fields: { ...parsePaymentText(result.native_text || ''), ...parsePaymentText(result.text) }, needs_review: true };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(422, 'Could not read this screenshot. Try a clearer image or enter the details.');
  } finally {
    clearTimeout(timer);
    if (worker) await worker.terminate().catch(() => {});
    if (languageDir) fs.rmSync(languageDir, { recursive: true, force: true });
    busy = false;
  }
}
