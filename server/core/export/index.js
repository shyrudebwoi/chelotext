// Экспорт: единый интерфейс формата. TXT, MD, HTML, PDF, DOCX.
import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell, WidthType } from 'docx';
import { astToPlainText, astToMarkdown, astToHtml, BLOCK } from '../text/ast.js';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../config.js';

export const FORMATS = ['txt', 'md', 'html', 'pdf', 'docx'];

export const FORMAT_META = {
  txt: { label: 'TXT', mime: 'text/plain; charset=utf-8', ext: 'txt' },
  md: { label: 'Markdown', mime: 'text/markdown; charset=utf-8', ext: 'md' },
  html: { label: 'HTML', mime: 'text/html; charset=utf-8', ext: 'html' },
  pdf: { label: 'PDF', mime: 'application/pdf', ext: 'pdf' },
  docx: { label: 'DOCX', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' },
};

const FONT_CANDIDATES = [
  path.join(ROOT, 'public', 'fonts', 'Literata-Regular.ttf'),
  'C:/Windows/Fonts/georgia.ttf',
  'C:/Windows/Fonts/times.ttf',
  'C:/Windows/Fonts/arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
];
const BOLD_FONT_CANDIDATES = [
  path.join(ROOT, 'public', 'fonts', 'Literata-Bold.ttf'),
  'C:/Windows/Fonts/georgiab.ttf',
  'C:/Windows/Fonts/timesbd.ttf',
  'C:/Windows/Fonts/arialbd.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
];

function findFont(candidates) {
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // игнорируем
    }
  }
  return null;
}

export async function exportDocument(ast, format, { title = 'Челотекст' } = {}) {
  const normalized = String(format || '').toLowerCase();
  if (!FORMATS.includes(normalized)) {
    throw Object.assign(new Error('Этот формат пока не умеем'), { code: 'unsupported_format', status: 400 });
  }
  switch (normalized) {
    case 'txt':
      return { buffer: Buffer.from(astToPlainText(ast) + '\n', 'utf8'), meta: FORMAT_META.txt };
    case 'md':
      return { buffer: Buffer.from(astToMarkdown(ast), 'utf8'), meta: FORMAT_META.md };
    case 'html':
      return { buffer: Buffer.from(buildHtml(ast, title), 'utf8'), meta: FORMAT_META.html };
    case 'pdf':
      return { buffer: await buildPdf(ast, title), meta: FORMAT_META.pdf };
    case 'docx':
      return { buffer: await buildDocx(ast, title), meta: FORMAT_META.docx };
    default:
      throw Object.assign(new Error('Этот формат пока не умеем'), { code: 'unsupported_format', status: 400 });
  }
}

export function buildHtml(ast, title) {
  const { body } = astToHtml(ast);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { --ink:#1B1E23; --paper:#FAF8F4; --muted:#6B7280; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink);
         font-family: Georgia, "Times New Roman", serif; font-size:20px; line-height:1.75; }
  main { max-width: 46rem; margin: 0 auto; padding: 48px 24px 96px; }
  h1,h2,h3,h4 { font-family: "Trebuchet MS", system-ui, sans-serif; line-height:1.25; margin: 2em 0 .6em; }
  h1 { font-size: 2rem; } h2 { font-size: 1.55rem; } h3 { font-size: 1.3rem; } h4 { font-size: 1.12rem; }
  p { margin: 0 0 1.4em; }
  ul, ol { margin: 0 0 1.4em; padding-left: 1.4em; }
  li { margin-bottom: .5em; }
  blockquote { margin: 1.6em 0; padding: .2em 0 .2em 1.2em; border-left: 3px solid #C2701A; color:#3a3f47; }
  table { width:100%; border-collapse: collapse; margin: 1.6em 0; font-size: .92em; }
  th, td { border: 1px solid #E6E1D8; padding: 10px 12px; text-align: left; vertical-align: top; }
  th { background: #F1EDE6; font-family: "Trebuchet MS", system-ui, sans-serif; }
  hr { border:0; border-top:1px solid #E6E1D8; margin: 2.4em 0; }
  .footnotes { font-size: .88em; color: var(--muted); }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function buildPdf(ast, title) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 60, right: 60 }, info: { Title: title } });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const regular = findFont(FONT_CANDIDATES);
      const bold = findFont(BOLD_FONT_CANDIDATES) || regular;
      if (regular) doc.registerFont('body', regular);
      if (bold) doc.registerFont('body-bold', bold);
      const setBody = () => (regular ? doc.font('body') : doc.font('Times-Roman'));
      const setBold = () => (bold ? doc.font('body-bold') : doc.font('Times-Bold'));

      // Обложка-заголовок
      setBold();
      doc.fontSize(26).fillColor('#1B1E23').text(title, { lineGap: 4 });
      doc.moveDown(0.6);
      doc.strokeColor('#E6E1D8').lineWidth(1).moveTo(doc.x, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
      doc.moveDown(1);

      for (const block of ast.blocks || []) {
        switch (block.type) {
          case BLOCK.HEADING: {
            setBold();
            const size = block.level === 1 ? 20 : block.level === 2 ? 17 : 15;
            doc.moveDown(0.7).fontSize(size).fillColor('#1B1E23').text(block.text, { lineGap: 3 });
            doc.moveDown(0.4);
            break;
          }
          case BLOCK.PARAGRAPH:
            setBody();
            doc.fontSize(12.5).fillColor('#1B1E23').text(block.text, { lineGap: 5, align: 'left' });
            doc.moveDown(0.7);
            break;
          case BLOCK.QUOTE:
            setBody();
            doc.fontSize(12).fillColor('#3a3f47').text(block.text, { lineGap: 4, indent: 18 });
            doc.moveDown(0.7);
            break;
          case BLOCK.LIST:
            setBody();
            doc.fontSize(12.5).fillColor('#1B1E23');
            block.items.forEach((item, index) => {
              doc.text(`${block.ordered ? `${index + 1}.` : '•'}  ${item}`, { lineGap: 4, indent: 12 });
            });
            doc.moveDown(0.7);
            break;
          case BLOCK.TABLE: {
            drawPdfTable(doc, block, { setBody, setBold });
            doc.moveDown(0.7);
            break;
          }
          case BLOCK.FOOTNOTES:
            doc.moveDown(0.4);
            setBody();
            doc.fontSize(10.5).fillColor('#6B7280');
            block.items.forEach((item) => doc.text(item, { lineGap: 3 }));
            doc.moveDown(0.6);
            break;
          case BLOCK.DIVIDER:
            doc.moveDown(0.5).strokeColor('#E6E1D8').moveTo(doc.x, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke().moveDown(0.8);
            break;
          default:
            break;
        }
        if (doc.y > doc.page.height - doc.page.margins.bottom - 40) doc.addPage();
      }
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function drawPdfTable(doc, block, { setBody, setBold }) {
  const rows = block.header ? [block.header, ...block.rows] : block.rows;
  if (!rows.length) return;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const columns = Math.max(...rows.map((r) => r.length));
  const colWidth = usable / columns;
  const startX = doc.page.margins.left;
  let y = doc.y;
  const rowHeights = [];
  const fontSize = 10;

  rows.forEach((row, rowIndex) => {
    const cells = Array.from({ length: columns }, (_, i) => row[i] ?? '');
    const heights = cells.map((cell) => {
      if (rowIndex === 0) setBold();
      else setBody();
      doc.fontSize(fontSize);
      return doc.heightOfString(cell, { width: colWidth - 12 }) + 10;
    });
    const height = Math.max(...heights, 22);
    rowHeights.push(height);
    if (y + height > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    let x = startX;
    cells.forEach((cell, colIndex) => {
      doc.rect(x, y, colWidth, height).strokeColor('#E6E1D8').lineWidth(0.7).stroke();
      if (rowIndex === 0) {
        doc.rect(x, y, colWidth, height).fillColor('#F1EDE6').fill();
        doc.rect(x, y, colWidth, height).strokeColor('#E6E1D8').lineWidth(0.7).stroke();
        setBold();
      } else {
        setBody();
      }
      doc.fontSize(fontSize).fillColor('#1B1E23').text(cell, x + 6, y + 5, { width: colWidth - 12 });
      x += colWidth;
    });
    y += height;
  });
  doc.y = y + 4;
  doc.x = startX;
}

async function buildDocx(ast, title) {
  const children = [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1, spacing: { after: 240 } }),
  ];

  for (const block of ast.blocks || []) {
    switch (block.type) {
      case BLOCK.HEADING:
        children.push(
          new Paragraph({
            text: block.text,
            heading:
              block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
            spacing: { before: 240, after: 120 },
          }),
        );
        break;
      case BLOCK.PARAGRAPH:
        children.push(new Paragraph({ children: [new TextRun({ text: block.text, size: 24 })], spacing: { after: 200, line: 360 } }));
        break;
      case BLOCK.QUOTE:
        children.push(
          new Paragraph({
            children: [new TextRun({ text: block.text, italics: true, size: 24 })],
            indent: { left: 480 },
            spacing: { after: 200 },
          }),
        );
        break;
      case BLOCK.LIST:
        block.items.forEach((item, index) => {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: block.ordered ? `${index + 1}. ${item}` : `• ${item}`, size: 24 })],
              indent: { left: 360 },
              spacing: { after: 100 },
            }),
          );
        });
        break;
      case BLOCK.TABLE: {
        const rows = block.header ? [block.header, ...block.rows] : block.rows;
        if (!rows.length) break;
        const columns = Math.max(...rows.map((r) => r.length));
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: rows.map(
              (row, rowIndex) =>
                new TableRow({
                  children: Array.from({ length: columns }, (_, i) =>
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [new TextRun({ text: row[i] ?? '', bold: rowIndex === 0, size: 22 })],
                        }),
                      ],
                    }),
                  ),
                }),
            ),
          }),
        );
        children.push(new Paragraph({ text: '', spacing: { after: 200 } }));
        break;
      }
      case BLOCK.FOOTNOTES:
        block.items.forEach((item) => {
          children.push(new Paragraph({ children: [new TextRun({ text: item, size: 20, color: '6B7280' })], spacing: { after: 80 } }));
        });
        break;
      case BLOCK.DIVIDER:
        children.push(new Paragraph({ text: '— — —', alignment: 'center', spacing: { before: 200, after: 200 } }));
        break;
      default:
        break;
    }
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

export function filenameFor(title, format) {
  const safe = String(title || 'chelotext')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'chelotext';
  return `${safe}.${FORMAT_META[format]?.ext || 'txt'}`;
}
