// Генерация PNG-иконок для PWA из SVG-геометрии (без внешних картинок).
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/config.js';

const OUT = path.join(ROOT, 'public', 'icons');

function drawIcon(size, { maskable = false } = {}) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const pad = maskable ? size * 0.14 : 0;
  const inner = size - pad * 2;

  // Фон: для maskable — на весь холст (safe zone внутри), для обычной — со скруглением.
  if (maskable) {
    ctx.fillStyle = '#0F766E';
    ctx.fillRect(0, 0, size, size);
  } else {
    const radius = size * 0.22;
    ctx.fillStyle = '#0F766E';
    roundRect(ctx, 0, 0, size, size, radius);
    ctx.fill();
  }

  const scale = inner / 64;
  ctx.save();
  ctx.translate(pad, pad);
  ctx.scale(scale, scale);

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 4.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // «Ч»-подобная форма: две вертикальные дуги + засечки
  ctx.beginPath();
  ctx.moveTo(16, 20);
  ctx.lineTo(34, 20);
  ctx.arcTo(40, 20, 40, 26, 6);
  ctx.arcTo(40, 32, 34, 32, 6);
  ctx.lineTo(16, 32);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(16, 32);
  ctx.lineTo(37, 32);
  ctx.arcTo(43, 32, 43, 38, 6);
  ctx.arcTo(43, 44, 37, 44, 6);
  ctx.lineTo(16, 44);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(46, 24);
  ctx.lineTo(50, 24);
  ctx.moveTo(46, 40);
  ctx.lineTo(50, 40);
  ctx.stroke();

  ctx.restore();
  return canvas;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function write(canvas, filename) {
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(OUT, filename), buffer);
  console.log(`OK ${filename} (${Math.round(buffer.length / 1024)} КБ)`);
}

fs.mkdirSync(OUT, { recursive: true });
write(drawIcon(192), 'icon-192.png');
write(drawIcon(512), 'icon-512.png');
write(drawIcon(512, { maskable: true }), 'icon-maskable-512.png');
write(drawIcon(180), 'apple-touch-icon.png');
console.log('Иконки готовы');
