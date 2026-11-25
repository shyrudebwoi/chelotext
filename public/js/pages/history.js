// История документов: список, поиск, удаление.
import { api, toast, modal, formatNumber, formatDate, escapeHtml } from '../app.js';

const list = document.getElementById('history-list');
const empty = document.getElementById('history-empty');
const search = document.getElementById('history-search');
const moreRow = document.getElementById('history-more-row');
const moreBtn = document.getElementById('history-more');

const PAGE = 20;
let offset = 0;
let query = '';
let total = 0;
let items = [];

const STATUS_LABELS = {
  queued: 'в очереди',
  processing: 'обрабатывается',
  done: 'готово',
  failed: 'ошибка',
  cancelled: 'отменено',
};

async function load({ append = false } = {}) {
  try {
    const data = await api(`/api/documents?q=${encodeURIComponent(query)}&limit=${PAGE}&offset=${offset}`);
    total = data.total;
    items = append ? [...items, ...data.items] : data.items;
    render();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function render() {
  empty.classList.toggle('hidden', items.length > 0);
  list.innerHTML = items
    .map((item) => {
      const status = item.lastStatus ? `<span class="badge">${STATUS_LABELS[item.lastStatus] || item.lastStatus}</span>` : '';
      const ocr = item.fromOcr ? '<span class="badge badge--ocr">из OCR</span>' : '';
      const sourceLabel = { paste: 'текст', url: 'ссылка', file: 'файл' }[item.source] || item.source;
      return `
        <article class="history-item" data-id="${item.id}">
          <div class="history-item__main">
            <div class="history-item__title">${escapeHtml(item.title || item.excerpt || 'Без названия')}</div>
            <div class="history-item__excerpt">${escapeHtml(item.excerpt || '')}</div>
            <div class="history-item__meta">
              <span>${formatDate(item.createdAt)}</span>
              <span>${formatNumber(item.charCount)} знаков</span>
              <span>${sourceLabel}</span>
              ${ocr}
              ${status}
            </div>
          </div>
          <div class="history-item__actions">
            ${item.lastJobId ? `<a class="btn btn--secondary btn--sm" href="/app?job=${item.lastJobId}">Открыть</a>` : ''}
            <button class="btn btn--ghost btn--sm" data-delete="${item.id}" aria-label="Удалить «${escapeHtml(item.title || 'текст')}»">Удалить</button>
          </div>
        </article>`;
    })
    .join('');

  moreRow.hidden = items.length >= total;
}

list.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-delete]');
  if (!button) return;
  const id = button.dataset.delete;
  const ok = await modal({
    title: 'Удалить текст?',
    text: 'Текст и результат удалятся навсегда. Это не вернуть.',
    confirmLabel: 'Удалить',
  });
  if (!ok) return;
  try {
    await api(`/api/documents/${id}`, { method: 'DELETE' });
    items = items.filter((item) => String(item.id) !== String(id));
    total = Math.max(0, total - 1);
    render();
    toast('Удалили', 'success', 2500);
  } catch (error) {
    toast(error.message, 'error');
  }
});

let searchTimer = null;
search?.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    query = search.value.trim();
    offset = 0;
    load();
  }, 300);
});

moreBtn?.addEventListener('click', () => {
  offset += PAGE;
  load({ append: true });
});

load();
