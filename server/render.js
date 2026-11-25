// SSR-слой: общий каркас страницы + компоненты. Клиентский JS добавляет интерактивность.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, ROOT } from './config.js';

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export { esc };

// Версия статики по содержимому файла: браузер и service worker не залипнут
// на старой версии CSS/JS после правок. Кэш держим по mtime+size, чтобы
// в разработке правка файла сразу меняла версию без перезапуска сервера.
const assetVersions = new Map();

export function assetVersion(urlPath) {
  const clean = String(urlPath || '').split('?')[0];
  let stamp = '';
  try {
    const file = path.join(ROOT, 'public', clean.replace(/^\/+/, ''));
    const stat = fs.statSync(file);
    stamp = `${stat.size}:${stat.mtimeMs}`;
    const cached = assetVersions.get(clean);
    if (cached && cached.stamp === stamp) return cached.version;
    const hash = crypto.createHash('sha1');
    hash.update(String(stat.size));
    hash.update(String(stat.mtimeMs));
    hash.update(fs.readFileSync(file));
    const version = hash.digest('hex').slice(0, 8);
    assetVersions.set(clean, { stamp, version });
    return version;
  } catch {
    assetVersions.delete(clean);
    return '';
  }
}

export function asset(urlPath) {
  const version = assetVersion(urlPath);
  if (!version) return urlPath;
  return `${urlPath}${urlPath.includes('?') ? '&' : '?'}v=${version}`;
}

export const icon = (name, size = 20, cls = '') => {
  const paths = ICONS[name] || ICONS.dot;
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
};

const ICONS = {
  logo: '<path d="M4 6h9a3 3 0 0 1 0 6H4z"/><path d="M4 12h11a3 3 0 0 1 0 6H4z"/><path d="M18 8h2M18 16h2"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>',
  language: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  settings: '<path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.2a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.2a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.2a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.2a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.7 3L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.7-3L3 16"/><path d="M3 21v-5h5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  sparkle: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  logout: '<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
};

// ---------- Иллюстрации (локальные SVG, палитра Teal/Amber) ----------
export const illustration = (name, cls = '') => {
  const art = ILLUSTRATIONS[name] || ILLUSTRATIONS.reading;
  return `<svg class="${cls}" viewBox="0 0 320 240" fill="none" role="img" aria-label="${esc(art.alt)}" xmlns="http://www.w3.org/2000/svg">${art.svg}</svg>`;
};

const ILLUSTRATIONS = {
  reading: {
    alt: 'Человек читает текст, разбитый на короткие абзацы',
    svg: `
      <rect x="18" y="30" width="200" height="180" rx="12" fill="#FFFFFF" stroke="#E6E1D8" stroke-width="2"/>
      <rect x="38" y="52" width="96" height="12" rx="6" fill="#0F766E"/>
      <rect x="38" y="80" width="160" height="8" rx="4" fill="#E6E1D8"/>
      <rect x="38" y="96" width="150" height="8" rx="4" fill="#E6E1D8"/>
      <rect x="38" y="112" width="132" height="8" rx="4" fill="#E6E1D8"/>
      <rect x="38" y="136" width="72" height="10" rx="5" fill="#C2701A" opacity=".5"/>
      <rect x="38" y="160" width="160" height="8" rx="4" fill="#E6E1D8"/>
      <rect x="38" y="176" width="140" height="8" rx="4" fill="#E6E1D8"/>
      <circle cx="250" cy="96" r="42" fill="#0F766E" opacity=".1"/>
      <path d="M232 96l12 12 22-24" stroke="#0F766E" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="262" cy="170" r="26" fill="#C2701A" opacity=".14"/>`,
  },
  empty: {
    alt: 'Пустая страница и карандаш',
    svg: `
      <rect x="70" y="40" width="150" height="180" rx="12" fill="#FFFFFF" stroke="#E6E1D8" stroke-width="2"/>
      <rect x="92" y="70" width="106" height="9" rx="4.5" fill="#E6E1D8"/>
      <rect x="92" y="92" width="84" height="9" rx="4.5" fill="#E6E1D8"/>
      <rect x="92" y="114" width="98" height="9" rx="4.5" fill="#E6E1D8"/>
      <circle cx="228" cy="176" r="40" fill="#0F766E" opacity=".1"/>
      <path d="M214 190l8-22 22-22 14 14-22 22z" fill="#C2701A" opacity=".35"/>
      <path d="M214 190l6-16 10 10z" fill="#C2701A"/>`,
  },
  error: {
    alt: 'Страница с восклицательным знаком',
    svg: `
      <circle cx="160" cy="120" r="74" fill="#0F766E" opacity=".08"/>
      <circle cx="160" cy="120" r="52" fill="#FFFFFF" stroke="#E6E1D8" stroke-width="2"/>
      <path d="M160 94v34" stroke="#C2701A" stroke-width="7" stroke-linecap="round"/>
      <circle cx="160" cy="148" r="4.5" fill="#C2701A"/>`,
  },
  ocr: {
    alt: 'Сканирование страницы документа',
    svg: `
      <rect x="76" y="34" width="168" height="180" rx="10" fill="#FFFFFF" stroke="#E6E1D8" stroke-width="2"/>
      <rect x="100" y="60" width="120" height="8" rx="4" fill="#E6E1D8"/>
      <rect x="100" y="80" width="100" height="8" rx="4" fill="#E6E1D8"/>
      <rect x="100" y="100" width="112" height="8" rx="4" fill="#E6E1D8"/>
      <rect x="100" y="120" width="88" height="8" rx="4" fill="#E6E1D8"/>
      <rect x="100" y="140" width="104" height="8" rx="4" fill="#E6E1D8"/>
      <rect x="76" y="96" width="168" height="4" fill="#C2701A"/>
      <rect x="76" y="96" width="168" height="46" fill="#C2701A" opacity=".1"/>`,
  },
};

// ---------- Layout ----------
export function renderPage({ page, title, description, body, user, config: cfg = config, scripts = [], styles = [] }) {
  const navUser = user
    ? `<a class="nav__link nav__link--hide-mobile" href="/history">${icon('history', 18)}<span>История</span></a>
       <a class="nav__link" href="/settings" aria-label="Настройки">${icon('settings', 18)}<span class="sr-only">Настройки</span></a>
       <button class="nav__link nav__link--logout" type="button" data-logout aria-label="Выйти из аккаунта" title="Выйти">${icon('logout', 18)}<span class="sr-only">Выйти</span></button>
       <a class="nav__link" href="/app">Вставить текст</a>`
    : `<a class="nav__link nav__link--hide-mobile" href="/login">Войти</a>
       <a class="btn btn--sm" href="/start">Начать</a>`;

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} · Челотекст</title>
<meta name="description" content="${esc(description || 'Челотекст делает текст легче для чтения, сохраняя смысл, факты, имена и числа.')}">
<meta name="theme-color" content="#0F766E">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icons/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
<link rel="stylesheet" href="${esc(asset('/styles/app.css'))}">
${styles.map((href) => `<link rel="stylesheet" href="${esc(asset(href))}">`).join('')}
<meta property="og:title" content="${esc(title)} · Челотекст">
<meta property="og:description" content="${esc(description || '')}">
<meta property="og:type" content="website">
</head>
<body data-page="${esc(page)}">
<a class="skip-link" href="#main">Перейти к содержимому</a>
<header class="site-header" id="site-header">
  <div class="container site-header__inner">
    <a class="logo" href="/" aria-label="Челотекст — на главную">
      <span class="logo__mark">${icon('logo', 28)}</span>
      <span>Челотекст</span>
    </a>
    <nav class="nav" aria-label="Основное меню">
      ${navUser}
    </nav>
  </div>
</header>
<main id="main" tabindex="-1">
${body}
</main>
<footer class="site-footer">
  <div class="container site-footer__inner">
    <span>© ${new Date().getFullYear()} Челотекст. Текст читается легче — смысл остаётся.</span>
    <nav aria-label="Правовая информация">
      <a href="/legal/privacy">Политика данных</a>
      <a href="/legal/terms">Оферта</a>
      <a href="/legal/personal-data">Форма субъекта ПДн</a>
    </nav>
  </div>
</footer>
<div class="toast-host" id="toast-host" aria-live="polite" aria-atomic="false"></div>
<script type="module" src="${esc(asset('/js/app.js'))}"></script>
${scripts.map((src) => `<script type="module" src="${esc(asset(src))}"></script>`).join('')}
</body>
</html>`;
}

export const components = { icon, illustration, esc };
