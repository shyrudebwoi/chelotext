// Service worker: кэш статики и офлайн-заглушка.
// Важно: офлайн-обработка не в MVP (ТЗ 5), кэшируем только оболочку.
// Меняйте версию при изменении статики: старый кэш удалится при активации.
const VERSION = 'chelotext-v3';
const STATIC_CACHE = `${VERSION}-static`;
const PAGES_CACHE = `${VERSION}-pages`;

const PRECACHE = [
  '/styles/app.css',
  '/js/app.js',
  '/icons/favicon.svg',
  '/icons/icon-192.png',
  '/manifest.webmanifest',
  '/fonts/manrope-cyrillic-400-normal.woff2',
  '/fonts/manrope-cyrillic-600-normal.woff2',
  '/fonts/manrope-cyrillic-800-normal.woff2',
  '/fonts/literata-cyrillic-400-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // API не кэшируем никогда: там приватные данные.
  if (url.pathname.startsWith('/api/')) return;

  // Статика: cache-first.
  if (/^\/(styles|js|fonts|icons)\//.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      }).catch(() => cached)),
    );
    return;
  }

  // Страницы: network-first с фоллбеком из кэша.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(PAGES_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || offlinePage())),
    );
  }
});

function offlinePage() {
  return new Response(
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Нет сети · Челотекст</title>
    <style>body{margin:0;background:#FAF8F4;color:#1B1E23;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px;text-align:center}
    h1{font-size:26px;margin:0 0 12px}p{color:#6B7280;max-width:32em;margin:0 0 24px}
    a{display:inline-block;background:#0F766E;color:#fff;text-decoration:none;padding:14px 24px;border-radius:12px;font-weight:600}</style></head>
    <body><div><h1>Нет сети</h1><p>Челотекст работает онлайн: обработка текста происходит на сервере. Проверь подключение и попробуй снова.</p>
    <a href="/">Обновить</a></div></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
