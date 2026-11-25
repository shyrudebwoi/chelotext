// Точка входа: Express-сервер, статика, API, SSR-страницы.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { config, ROOT } from './config.js';
import { getDb, closeDb, q, now } from './db/index.js';
import {
  attachUser, securityHeaders, csrfGuard, rateLimitMiddleware, requireAuth,
} from './middleware/index.js';
import { authRouter } from './routes/auth.js';
import { processRouter } from './routes/process.js';
import { historyRouter } from './routes/history.js';
import { recoverStuckJobs, queueStats } from './jobs/queue.js';
import { pruneSessions, publicUser, hasConsent } from './services/users.js';
import { renderPage } from './render.js';
import { PAGES, notFound, serverError } from './pages/index.js';
import { providerInfo } from './core/llm/provider.js';
import { isOcrAvailable } from './core/extract/ocr.js';
import { purgeExpired } from './services/documents.js';
import { startVkBot, stopVkBot } from './services/vk-bot.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(attachUser);
  app.use(csrfGuard);

  const globalLimiter = rateLimitMiddleware({
    name: 'global',
    limit: config.rateLimit.globalPerMinute,
    windowMs: 60_000,
  });
  app.use('/api', globalLimiter);

  app.get('/healthz', (req, res) => {
    res.json({
      ok: true,
      uptime: Math.round(process.uptime()),
      queue: queueStats(),
      llm: providerInfo(),
      version: '1.0.0',
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api', processRouter);
  app.use('/api', historyRouter);

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Такого метода нет', code: 'not_found' });
  });

  // Статика
  // sw.js не кэшируем: иначе новая версия статики не подхватится вовремя.
  app.get('/sw.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(ROOT, 'public/sw.js'));
  });
  app.use('/fonts', express.static(path.join(ROOT, 'public/fonts'), { maxAge: '30d', immutable: true }));
  app.use('/icons', express.static(path.join(ROOT, 'public/icons'), { maxAge: '7d' }));
  app.use('/styles', express.static(path.join(ROOT, 'public/styles'), { maxAge: '1h' }));
  app.use('/js', express.static(path.join(ROOT, 'public/js'), { maxAge: '1h' }));
  app.use(express.static(path.join(ROOT, 'public'), { maxAge: '1h', index: false }));

  // Страницы
  for (const page of PAGES) {
    app.get(page.path, (req, res) => {
      const view = page.render({ req, params: req.params, user: req.user ? publicUser(req.user) : null });
      if (view.redirect) return res.redirect(view.redirect);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(renderPage({ ...view, page: page.name, user: req.user ? publicUser(req.user) : null, config }));
    });
  }

  app.use((req, res) => {
    res.status(404);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(
      renderPage({
        page: '404',
        ...notFound(),
        description: 'Такой страницы нет',
        user: req.user ? publicUser(req.user) : null,
        config,
      }),
    );
  });

  // Обработчик ошибок: без стектрейсов наружу.
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error('[error]', error?.message);
    if (req.path.startsWith('/api/')) {
      return res.status(error.status || 500).json({
        error: error.status && error.status < 500 ? error.message : 'Что-то пошло не так. Попробуй ещё раз',
        code: error.code || 'internal',
      });
    }
    return res.status(500).send(
      renderPage({
        page: 'error',
        ...serverError(),
        description: 'Попробуй обновить страницу',
        user: req.user ? publicUser(req.user) : null,
        config,
      }),
    );
  });

  return app;
}

// ---------- Периодические задачи ----------
function startMaintenance() {
  const run = () => {
    try {
      pruneSessions();
      purgeExpired(config.retentionDays);
    } catch (error) {
      console.error('[maintenance]', error.message);
    }
  };
  const timer = setInterval(run, 6 * 3600 * 1000);
  timer.unref?.();
}

async function main() {
  getDb();
  recoverStuckJobs();
  startMaintenance();
  const app = createApp();
  const server = app.listen(config.port, config.host, async () => {
    const ocr = await isOcrAvailable().catch(() => false);
    console.info(`Челотекст запущен: http://${config.host}:${config.port}`);
    console.info(`LLM: ${config.llm.provider}${config.llm.enabled ? '' : ' (только правила)'} · OCR: ${ocr ? config.ocr.languages.join('+') : 'выключен'}`);
    startVkBot();
  });

  const shutdown = () => {
    stopVkBot();
    server.close(() => {
      closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref?.();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  main().catch((error) => {
    console.error('Не удалось запустить:', error);
    process.exit(1);
  });
}

export { q, now };
