// Middleware: cookie-сессии, обязательный gate согласия, rate-limit, защита от CSRF.
import { config } from '../config.js';
import { getSession, verifySessionCookie, signSessionId, publicUser } from '../services/users.js';
import { rateLimit } from '../lib/rateLimit.js';

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(value);
  }
  return out;
}

export function setSessionCookie(res, sessionId) {
  const signed = signSessionId(sessionId);
  const maxAge = config.sessionTtlDays * 24 * 3600;
  res.append(
    'Set-Cookie',
    `${config.cookieName}=${encodeURIComponent(signed)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secureCookies ? '; Secure' : ''}`,
  );
}

export function clearSessionCookie(res) {
  res.append(
    'Set-Cookie',
    `${config.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.secureCookies ? '; Secure' : ''}`,
  );
}

export function attachUser(req, res, next) {
  const cookies = parseCookies(req.headers.cookie || '');
  const raw = cookies[config.cookieName];
  const sessionId = raw ? verifySessionCookie(raw) : null;
  const found = sessionId ? getSession(sessionId) : null;
  req.sessionId = sessionId;
  req.user = found ? found.user : null;
  req.userPublic = found ? publicUser(found.user) : null;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Нужно войти', code: 'unauthorized' });
  }
  return next();
}

// Жёсткий gate: без согласия API обязан вернуть 403 (ТЗ 8).
export function requireConsent(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Нужно войти', code: 'unauthorized' });
  if (req.user.consent_status !== 'granted') {
    return res.status(403).json({
      error: 'Сначала нужно согласие на обработку данных',
      code: 'consent_required',
      policyVersion: config.policyVersion,
    });
  }
  return next();
}

export function clientIp(req) {
  if (config.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '';
}

export function rateLimitMiddleware({ name, limit, windowMs }) {
  return (req, res, next) => {
    const ip = clientIp(req);
    const userKey = req.user ? `u${req.user.id}` : `ip${ip}`;
    const result = rateLimit({ key: `${name}:${userKey}`, limit, windowMs });
    if (!result.allowed) {
      res.setHeader('Retry-After', Math.ceil(result.retryAfterMs / 1000));
      return res.status(429).json({
        error: 'Слишком много запросов. Подожди немного и попробуй снова',
        code: 'rate_limited',
        retryAfterMs: result.retryAfterMs,
      });
    }
    return next();
  };
}

// CSRF: Origin + заголовок X-Requested-With от нашего клиента (ст. 19 152-ФЗ).
// SameSite=Lax даёт базовую защиту, но не заменяет проверку изменяющих запросов.
export function csrfGuard(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (req.path.startsWith('/api/')) {
    const requestedBy = req.headers['x-requested-with'];
    if (requestedBy !== 'fetch' && requestedBy !== 'XMLHttpRequest') {
      return res.status(403).json({ error: 'Запрос отклонён', code: 'csrf' });
    }
  }
  const origin = req.headers.origin;
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      const requestHost = req.headers.host;
      if (originHost !== requestHost) {
        return res.status(403).json({ error: 'Запрос отклонён', code: 'csrf' });
      }
    } catch {
      return res.status(403).json({ error: 'Запрос отклонён', code: 'csrf' });
    }
  }
  return next();
}

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  if (config.secureCookies) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}
