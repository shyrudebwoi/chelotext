// Извлечение статьи по URL. Осторожно: без SSRF — блокируем локальные адреса.
import dns from 'node:dns/promises';
import net from 'node:net';
import * as cheerio from 'cheerio';
import { normalizeText, titleFromText } from './index.js';
import { parsePlainText } from '../text/ast.js';

const BLOCKED_HOSTS = /^(localhost|.*\.local|.*\.internal)$/i;

export async function extractUrl(rawUrl) {
  const url = normalizeUrl(rawUrl);
  await assertPublicHost(url.hostname);

  const response = await fetch(url.toString(), {
    redirect: 'follow',
    headers: {
      'User-Agent': 'ChelotextBot/1.0 (+https://chelotext.local)',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'ru,en;q=0.8',
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw Object.assign(new Error(`Сайт ответил ошибкой ${response.status}`), { code: 'fetch_failed', status: 422 });
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('html') && !contentType.includes('text/plain')) {
    throw Object.assign(new Error('По ссылке не страница с текстом'), { code: 'unsupported_url', status: 415 });
  }

  const html = await response.text();
  const { text, title } = extractReadable(html, url.toString());
  const normalized = normalizeText(text);
  return {
    text: normalized,
    ast: parsePlainText(normalized),
    meta: { source: 'url', url: url.toString(), chars: normalized.length, title },
    title: title || titleFromText(normalized) || url.hostname,
  };
}

function normalizeUrl(raw) {
  let value = String(raw || '').trim();
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Object.assign(new Error('Не похоже на ссылку'), { code: 'invalid_url', status: 400 });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw Object.assign(new Error('Поддерживаются только http и https'), { code: 'invalid_url', status: 400 });
  }
  return url;
}

// Защита от SSRF: не ходим в локальную сеть.
async function assertPublicHost(hostname) {
  if (BLOCKED_HOSTS.test(hostname)) {
    throw Object.assign(new Error('Этот адрес мы не открываем'), { code: 'blocked_host', status: 400 });
  }
  let addresses = [];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw Object.assign(new Error('Не удалось найти сайт по ссылке'), { code: 'dns_failed', status: 422 });
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw Object.assign(new Error('Этот адрес мы не открываем'), { code: 'blocked_host', status: 400 });
    }
  }
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    return false;
  }
  const lower = address.toLowerCase();
  return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

// Извлечение читаемого текста: убираем мусор, берём самый содержательный контейнер.
export function extractReadable(html, baseUrl = '') {
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, svg, form, nav, aside, header, footer, .ad, .ads, .advert, .banner, .cookie, .popup, .menu').remove();

  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('h1').first().text().trim() ||
    $('title').text().trim() ||
    '';

  const candidates = [];
  $('article, main, [role="main"], .post, .article, .content, .entry-content, #content').each((_, el) => {
    candidates.push({ el, score: textScore($(el)) });
  });
  if (!candidates.length) {
    $('body, div').each((_, el) => {
      const node = $(el);
      if (node.children('div, article, section').length > 3) return;
      candidates.push({ el, score: textScore(node) });
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0]?.el ? $(candidates[0].el) : $('body');

  // Преобразуем структуру в Markdown-подобный текст.
  const parts = [];
  best.find('h1, h2, h3, h4, p, li, blockquote, pre, table').each((_, el) => {
    const node = $(el);
    const tag = el.tagName.toLowerCase();
    const text = cleanInline(node.text());
    if (!text) return;
    if (/^h[1-4]$/.test(tag)) parts.push(`${'#'.repeat(Number(tag[1]))} ${text}`);
    else if (tag === 'li') parts.push(`- ${text}`);
    else if (tag === 'blockquote') parts.push(`> ${text}`);
    else if (tag === 'table') {
      const rows = [];
      node.find('tr').each((__, tr) => {
        const cells = [];
        $(tr).find('th, td').each((___, cell) => cells.push(cleanInline($(cell).text())));
        if (cells.length) rows.push(cells);
      });
      if (rows.length) {
        parts.push(`| ${rows[0].join(' | ')} |`);
        parts.push(`| ${rows[0].map(() => '---').join(' | ')} |`);
        for (const row of rows.slice(1)) parts.push(`| ${row.join(' | ')} |`);
      }
    } else parts.push(text);
  });

  let text = parts.join('\n\n');
  if (text.length < 200) {
    // Фоллбек: просто весь текст абзацев.
    text = best.find('p').map((_, el) => cleanInline($(el).text())).get().join('\n\n');
  }
  if (text.length < 80) text = cleanInline(best.text());
  return { text, title };
}

function textScore(node) {
  const text = node.text() || '';
  const paragraphs = node.find('p').length;
  return text.length * 0.5 + paragraphs * 120;
}

function cleanInline(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}
