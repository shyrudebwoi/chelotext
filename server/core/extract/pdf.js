// Извлечение PDF с сохранением структуры (ТЗ 4.1.1):
// - таблицы → Markdown-таблицы,
// - многоколоночная вёрстка → склейка в порядке чтения,
// - колонтитулы и номера страниц → вырезаются,
// - сноски → отдельный список с привязкой по номеру,
// - скан без текстового слоя → OCR через Tesseract.
import { config } from '../../config.js';
import { docFromBlocks, heading, paragraph, list, table, footnotes } from '../text/ast.js';
import { normalizeText } from './index.js';

let pdfjsPromise = null;
async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsPromise;
}

const MIN_TEXT_PER_PAGE = 40;

export async function extractPdf(buffer, filename) {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;

  const pageCount = doc.numPages;
  if (pageCount > config.limits.maxPdfPages) {
    throw Object.assign(
      new Error(`В файле ${pageCount} страниц. Больше ${config.limits.maxPdfPages} мы не берём`),
      { code: 'too_many_pages', status: 413, pages: pageCount },
    );
  }

  const pages = [];
  let usedOcr = false;
  let ocrConfidenceSum = 0;
  let ocrPages = 0;

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items.filter((item) => typeof item.str === 'string' && item.str.trim());
    const pageTextLength = items.reduce((sum, item) => sum + item.str.trim().length, 0);

    if (pageTextLength < MIN_TEXT_PER_PAGE) {
      // Похоже на скан: пробуем OCR.
      const ocr = await ocrPage(page, pageNumber);
      if (ocr) {
        usedOcr = true;
        ocrPages += 1;
        ocrConfidenceSum += ocr.confidence;
        pages.push({ pageNumber, items: [], lines: ocr.lines, fromOcr: true, confidence: ocr.confidence });
      } else {
        pages.push({ pageNumber, items: [], lines: [], fromOcr: false, confidence: 0 });
      }
    } else {
      const lines = buildLines(items, page.view);
      pages.push({ pageNumber, items, lines, fromOcr: false, confidence: null });
    }
    page.cleanup?.();
  }

  const { headerFooterKeys } = detectHeadersFooters(pages);
  const blocks = [];
  const footnoteBuffer = [];

  for (const page of pages) {
    const cleaned = page.lines.filter((line) => !headerFooterKeys.has(normalizeLineKey(line.text)));
    if (!cleaned.length) continue;
    const ordered = orderReading(cleaned);
    const pageBlocks = structureBlocks(ordered, { footnoteBuffer });
    blocks.push(...pageBlocks);
  }

  // Склеиваем абзацы, разорванные между страницами.
  const merged = mergeAcrossPages(blocks);
  if (footnoteBuffer.length) merged.push(footnotes(dedupe(footnoteBuffer)));

  const text = normalizeText(blocksToText(merged));
  if (text.length > config.limits.maxChars) {
    throw Object.assign(
      new Error(`Текст длиннее ${config.limits.maxChars.toLocaleString('ru-RU')} знаков. Убери часть или загрузи другой файл`),
      { code: 'too_long', status: 413, chars: text.length },
    );
  }

  return {
    text,
    ast: docFromBlocks(merged),
    meta: {
      source: 'file',
      kind: 'pdf',
      filename,
      pages: pageCount,
      chars: text.length,
      fromOcr: usedOcr,
      ocrPages,
      ocrConfidence: ocrPages ? Math.round((ocrConfidenceSum / ocrPages) * 10) / 10 : null,
      ocrLowConfidence: usedOcr && ocrPages > 0 && ocrConfidenceSum / ocrPages < config.ocr.minConfidence,
    },
    title: firstHeading(merged) || filename,
    fromOcr: usedOcr,
  };
}

// ---------- Построение строк из текстовых элементов ----------
function buildLines(items, view) {
  const viewHeight = view?.[3] ?? 0;
  const rows = items.map((item) => {
    const transform = item.transform || [1, 0, 0, 1, 0, 0];
    const x = transform[4];
    const y = transform[5];
    const height = Math.abs(transform[3]) || item.height || 10;
    return { text: item.str, x, y, height, width: item.width || item.str.length * height * 0.5 };
  });

  // Группируем по y с допуском на высоту строки.
  rows.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const row of rows) {
    const tolerance = Math.max(2, row.height * 0.45);
    const line = lines.find((l) => Math.abs(l.y - row.y) <= tolerance);
    if (line) {
      line.parts.push(row);
      line.y = (line.y * line.parts.length + row.y) / (line.parts.length + 1);
    } else {
      lines.push({ y: row.y, parts: [row] });
    }
  }

  return lines
    .map((line) => {
      line.parts.sort((a, b) => a.x - b.x);
      const text = line.parts.map((p) => p.text).join('').replace(/\s{2,}/g, ' ').trim();
      const minX = Math.min(...line.parts.map((p) => p.x));
      const maxX = Math.max(...line.parts.map((p) => p.x + p.width));
      const maxHeight = Math.max(...line.parts.map((p) => p.height));
      const gaps = [];
      for (let i = 1; i < line.parts.length; i += 1) {
        const gap = line.parts[i].x - (line.parts[i - 1].x + line.parts[i - 1].width);
        if (gap > maxHeight * 0.9) gaps.push({ gap, x: line.parts[i].x });
      }
      return {
        text,
        y: line.y,
        x: minX,
        endX: maxX,
        height: maxHeight,
        gaps,
        bottomGap: viewHeight ? viewHeight - line.y : 0,
        topGap: line.y,
        fromOcr: false,
      };
    })
    .filter((line) => line.text)
    .sort((a, b) => b.y - a.y);
}

// ---------- Колонтитулы и номера страниц ----------
function normalizeLineKey(text) {
  return String(text).replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();
}

function detectHeadersFooters(pages) {
  const counts = new Map();
  for (const page of pages) {
    const seen = new Set();
    for (const line of page.lines) {
      const key = normalizeLineKey(line.text);
      if (!key || key.length < 3) continue;
      if (!seen.has(key)) {
        seen.add(key);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  const headerFooterKeys = new Set();
  const threshold = Math.max(2, Math.ceil(pages.length * 0.5));
  for (const [key, count] of counts) {
    if (count >= threshold) headerFooterKeys.add(key);
  }
  // Отдельно выкидываем строки, состоящие только из номера страницы.
  for (const page of pages) {
    for (const line of page.lines) {
      if (/^(?:стр\.?\s*)?\d{1,4}(?:\s*(?:\/|из)\s*\d{1,4})?$/i.test(line.text.trim())) {
        headerFooterKeys.add(normalizeLineKey(line.text));
      }
    }
  }
  return { headerFooterKeys };
}

// ---------- Порядок чтения в многоколоночной вёрстке ----------
function orderReading(lines) {
  if (lines.length < 6) return lines;
  const xs = lines.map((l) => l.x).sort((a, b) => a - b);
  const minX = xs[0];
  const maxX = lines.reduce((max, l) => Math.max(max, l.endX), 0);
  const width = maxX - minX;
  if (width <= 0) return lines;

  // Ищем «разрыв» в распределении x: если есть заметная пустая полоса в середине — это две колонки.
  const mid = minX + width / 2;
  const left = lines.filter((l) => l.endX <= mid + width * 0.06);
  const right = lines.filter((l) => l.x >= mid - width * 0.06);
  const spanning = lines.filter((l) => l.endX > mid + width * 0.06 && l.x < mid - width * 0.06);

  const isTwoColumn =
    left.length >= 4 &&
    right.length >= 4 &&
    spanning.length <= Math.max(2, lines.length * 0.2) &&
    left.length + right.length >= lines.length * 0.7;

  if (!isTwoColumn) return lines;

  // Сначала идут «сквозные» строки (заголовки через всю ширину), затем левая колонка, затем правая.
  const spanningSorted = spanning.sort((a, b) => b.y - a.y);
  const leftSorted = left.sort((a, b) => b.y - a.y);
  const rightSorted = right.sort((a, b) => b.y - a.y);
  return [...spanningSorted, ...leftSorted, ...rightSorted];
}

// ---------- Структура: заголовки, списки, таблицы, сноски ----------
function structureBlocks(lines, { footnoteBuffer }) {
  const blocks = [];
  const bodyLines = [];

  // Сноски: строки внизу страницы с маленьким кеглем и номером в начале.
  for (const line of lines) {
    const footnoteMatch = /^(?:\[\s*(\d{1,3})\s*\]|(\d{1,3})[.)]\s+)(.{10,})$/.exec(line.text);
    if (footnoteMatch && (line.bottomGap > 0 ? line.bottomGap < 220 : false)) {
      const number = footnoteMatch[1] || footnoteMatch[2];
      footnoteBuffer.push(`${number}. ${footnoteMatch[3].trim()}`);
      continue;
    }
    bodyLines.push(line);
  }

  const medianHeight = median(bodyLines.map((l) => l.height).filter(Boolean)) || 10;

  // Таблицы: несколько подряд строк с одинаковыми «провалами» по x.
  let index = 0;
  while (index < bodyLines.length) {
    const tableRows = [];
    let cursor = index;
    while (cursor < bodyLines.length) {
      const line = bodyLines[cursor];
      if (!line.gaps || line.gaps.length < 1) break;
      if (tableRows.length && Math.abs(line.gaps.length - tableRows[0].gaps.length) > 0) break;
      tableRows.push(line);
      cursor += 1;
      if (tableRows.length >= 2 && (cursor >= bodyLines.length || !bodyLines[cursor].gaps?.length)) break;
    }
    if (tableRows.length >= 2) {
      const rows = tableRows.map((line) => splitByGaps(line));
      if (rows.every((r) => r.length >= 2)) {
        blocks.push(table(rows.slice(1), rows[0]));
        index = cursor;
        continue;
      }
    }
    index += 1;
  }

  // Строки, не попавшие в таблицы.
  const tableLineSet = new Set();
  for (const block of blocks) {
    if (block.type !== 'table') continue;
    for (const line of bodyLines) {
      if (splitByGaps(line).length >= 2) tableLineSet.add(line);
    }
  }
  const remaining = bodyLines.filter((l) => !tableLineSet.has(l));

  // Заголовки: заметно крупнее медианы, короткие, без точки в конце.
  let paragraphBuffer = [];
  const flushParagraph = () => {
    if (!paragraphBuffer.length) return;
    const text = joinLines(paragraphBuffer.map((l) => l.text));
    paragraphBuffer = [];
    if (text) blocks.push(paragraph(text));
  };

  for (let i = 0; i < remaining.length; i += 1) {
    const line = remaining[i];
    const isBig = line.height >= medianHeight * 1.25;
    const isShort = line.text.length <= 110;
    const noPeriod = !/[.!?…]$/.test(line.text);
    const next = remaining[i + 1];
    const isolated = !next || next.height < line.height * 0.95 || next.y - line.y > line.height * 2.2;

    if (isBig && isShort && (noPeriod || isolated) && line.text.split(/\s+/).length <= 14) {
      flushParagraph();
      blocks.push(heading(line.text.replace(/[:.]+$/, ''), headingLevel(line.height, medianHeight)));
      continue;
    }

    // Маркированный список
    const listMatch = /^(?:[-•*–—]|\d{1,2}[.)])\s+(.+)$/.exec(line.text);
    if (listMatch) {
      flushParagraph();
      const items = [listMatch[1].trim()];
      let cursor = i + 1;
      while (cursor < remaining.length) {
        const m = /^(?:[-•*–—]|\d{1,2}[.)])\s+(.+)$/.exec(remaining[cursor].text);
        if (!m) break;
        items.push(m[1].trim());
        cursor += 1;
      }
      if (items.length >= 2) {
        blocks.push(list(items, /^\d/.test(line.text)));
        i = cursor - 1;
        continue;
      }
    }

    paragraphBuffer.push(line);
    // Разрыв абзаца: большой вертикальный промежуток или смена кегля.
    if (next) {
      const gap = line.y - next.y;
      if (gap > line.height * 1.9 || Math.abs(next.height - line.height) > medianHeight * 0.3) flushParagraph();
    }
  }
  flushParagraph();
  return blocks;
}

function splitByGaps(line) {
  const cells = [];
  let lastX = line.x;
  const sortedGaps = [...(line.gaps || [])].sort((a, b) => a.x - b.x);
  // Точное разбиение по исходным элементам невозможно после склейки, поэтому делим по пробелам,
  // сохраняя структуру: количество ячеек = количество «провалов» + 1.
  const parts = line.text.split(/\s{2,}|\s\|\s|\s{3,}/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= sortedGaps.length + 1) return parts;
  // Фоллбек: делим по «|» или по 3+ пробелам.
  const byPipe = line.text.split('|').map((p) => p.trim()).filter(Boolean);
  if (byPipe.length >= 2) return byPipe;
  return [line.text];
}

function headingLevel(height, medianHeight) {
  const ratio = height / medianHeight;
  if (ratio >= 1.8) return 1;
  if (ratio >= 1.45) return 2;
  return 3;
}

function joinLines(texts) {
  let out = '';
  for (const text of texts) {
    if (!out) {
      out = text;
      continue;
    }
    if (/-$/.test(out)) out = out.slice(0, -1) + text;
    else out += ` ${text}`;
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

function mergeAcrossPages(blocks) {
  const merged = [];
  for (const block of blocks) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.type === 'paragraph' &&
      block.type === 'paragraph' &&
      !/[.!?…:;]$/.test(prev.text) &&
      /^[а-яёa-z(«"]/i.test(block.text)
    ) {
      prev.text = `${prev.text} ${block.text}`.replace(/\s{2,}/g, ' ');
      continue;
    }
    merged.push(block);
  }
  return merged;
}

function blocksToText(blocks) {
  return blocks
    .map((block) => {
      if (block.type === 'heading') return `${'#'.repeat(block.level || 2)} ${block.text}`;
      if (block.type === 'paragraph') return block.text;
      if (block.type === 'list') return block.items.map((i) => `- ${i}`).join('\n');
      if (block.type === 'table') {
        const rows = block.rows || [];
        if (!rows.length) return '';
        const header = block.header || rows[0];
        const body = block.header ? rows : rows.slice(1);
        return [
          `| ${header.join(' | ')} |`,
          `| ${header.map(() => '---').join(' | ')} |`,
          ...body.map((r) => `| ${r.join(' | ')} |`),
        ].join('\n');
      }
      if (block.type === 'footnotes') return block.items.map((i) => i).join('\n');
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function firstHeading(blocks) {
  const found = blocks.find((b) => b.type === 'heading');
  return found?.text ?? null;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function dedupe(items) {
  return Array.from(new Set(items));
}

// ---------- OCR страницы ----------
async function ocrPage(page, pageNumber) {
  if (!config.ocr.enabled) return null;
  try {
    const { ocrImage, renderPdfPageToPng } = await import('./ocr.js');
    const png = await renderPdfPageToPng(page, 1.8);
    const result = await ocrImage(png);
    if (!result.text.trim()) return null;
    const lines = result.text.split('\n').map((text, index) => ({
      text: text.trim(),
      y: 1000 - index * 20,
      x: 0,
      endX: 1000,
      height: 10,
      gaps: [],
      bottomGap: index * 20,
      topGap: 1000 - index * 20,
      fromOcr: true,
    })).filter((l) => l.text);
    return { lines, confidence: result.confidence };
  } catch {
    return null;
  }
}
