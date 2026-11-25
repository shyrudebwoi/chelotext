// OCR через самохостимый Tesseract (tesseract.js) — бесплатно, без внешних API.
// Языки берутся из конфига (по умолчанию rus+eng, можно смешанный текст).
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from '../../config.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';

let workerPromise = null;
const TESSDATA_DIR = path.join(config.dataDir, 'tessdata');

function ensureTessdata() {
  fs.mkdirSync(TESSDATA_DIR, { recursive: true });
  for (const lang of config.ocr.languages) {
    const target = path.join(TESSDATA_DIR, `${lang}.traineddata.gz`);
    if (fs.existsSync(target)) continue;
    const candidates = [
      path.join(ROOT, 'node_modules', `@tesseract.js-data/${lang}`, '4.0.0', `${lang}.traineddata.gz`),
      path.join(ROOT, 'node_modules', `@tesseract.js-data/${lang}`, '4.0.0_best_int', `${lang}.traineddata.gz`),
    ];
    const source = candidates.find((p) => fs.existsSync(p));
    if (source) fs.copyFileSync(source, target);
  }
}

async function getWorker() {
  if (!config.ocr.enabled) return null;
  if (workerPromise) return workerPromise;
  ensureTessdata();
  workerPromise = (async () => {
    const { createWorker } = await import('tesseract.js');
    const langs = config.ocr.languages;
    const worker = await createWorker(langs, 1, {
      langPath: TESSDATA_DIR,
      gzip: true,
      cachePath: path.join(TESSDATA_DIR, 'cache'),
      logger: () => {},
    });
    return worker;
  })();
  return workerPromise;
}

export async function terminateOcr() {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker?.terminate?.();
  } catch {
    // ничего страшного: воркер мог уже умереть
  }
  workerPromise = null;
}

/**
 * Распознаёт одно изображение (PNG/JPEG buffer или canvas).
 * Возвращает { text, confidence }.
 */
export async function ocrImage(image) {
  const worker = await getWorker();
  if (!worker) throw Object.assign(new Error('OCR выключен'), { code: 'ocr_disabled' });
  const { data } = await worker.recognize(image);
  return {
    text: normalizeOcrText(data.text || ''),
    confidence: typeof data.confidence === 'number' ? data.confidence : 0,
  };
}

export async function isOcrAvailable() {
  if (!config.ocr.enabled) return false;
  try {
    ensureTessdata();
    return config.ocr.languages.every((lang) => fs.existsSync(path.join(TESSDATA_DIR, `${lang}.traineddata.gz`)));
  } catch {
    return false;
  }
}

function normalizeOcrText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    // Частые артефакты OCR: «|» вместо «I», лишние пробелы, склейка переносов.
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

// Рендер страницы PDF в PNG для OCR — без Poppler: pdfjs-dist + canvas.
export async function renderPdfPageToPng(pdfPage, scale = 1.7) {
  const viewport = pdfPage.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await pdfPage.render({ canvasContext: context, viewport, canvas }).promise;
  return canvas.toBuffer('image/png');
}

export async function imageFromBuffer(buffer) {
  return loadImage(buffer);
}
