// Общие клиентские утилиты: API, тосты, модалки, шапка.
export async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      'X-Requested-With': 'fetch',
      ...(options.headers || {}),
    },
    ...options,
  });

  let data = null;
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    data = await response.json().catch(() => null);
  }

  if (!response.ok) {
    const error = new Error(data?.error || 'Что-то пошло не так. Попробуй ещё раз');
    error.status = response.status;
    error.code = data?.code;
    error.data = data;
    error.retryAfterMs = data?.retryAfterMs;
    throw error;
  }
  return data;
}

export function toast(message, type = 'success', timeout = 5000) {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const text = document.createElement('div');
  text.textContent = message;
  const close = document.createElement('button');
  close.className = 'toast__close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Закрыть');
  close.textContent = '×';
  close.addEventListener('click', () => el.remove());

  el.append(text, close);
  host.append(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
}

export function modal({ title, text, confirmLabel = 'Удалить', cancelLabel = 'Отмена', danger = true }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h3 id="modal-title"></h3>
        <p id="modal-text"></p>
        <div class="modal__actions">
          <button class="btn btn--secondary" type="button" data-act="cancel"></button>
          <button class="btn ${danger ? 'btn--danger' : ''}" type="button" data-act="confirm"></button>
        </div>
      </div>`;
    backdrop.querySelector('#modal-title').textContent = title;
    backdrop.querySelector('#modal-text').textContent = text;
    backdrop.querySelector('[data-act="cancel"]').textContent = cancelLabel;
    backdrop.querySelector('[data-act="confirm"]').textContent = confirmLabel;

    const previouslyFocused = document.activeElement;
    const close = (value) => {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      previouslyFocused?.focus?.();
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') close(false);
      if (event.key === 'Tab') {
        const focusables = backdrop.querySelectorAll('button');
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    backdrop.querySelector('[data-act="cancel"]').addEventListener('click', () => close(false));
    backdrop.querySelector('[data-act="confirm"]').addEventListener('click', () => close(true));
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close(false);
    });
    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    backdrop.querySelector('[data-act="cancel"]').focus();
  });
}

export function setLoading(button, loading, label) {
  if (!button) return;
  if (loading) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="btn__spinner" aria-hidden="true"></span><span>${label || 'Подожди…'}</span>`;
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
  }
}

export function formatNumber(n) {
  return new Intl.NumberFormat('ru-RU').format(n);
}

export function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return `сегодня, ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}

// Шапка: тень при скролле
const header = document.getElementById('site-header');
if (header) {
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 4);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

// Выход из аккаунта: одна кнопка в шапке и в настройках.
document.addEventListener('click', async (event) => {
  const button = event.target.closest?.('[data-logout]');
  if (!button || button.dataset.logoutBusy) return;
  event.preventDefault();
  button.dataset.logoutBusy = '1';
  try {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.assign('/');
  } catch (error) {
    delete button.dataset.logoutBusy;
    toast(error.message, 'error');
  }
});

// PWA
// Регистрация SW без обёртки в `load` — модульные скрипты могут загрузиться
// после fire `load`, и регистрация потеряется.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Тема: уважаем системную, но не навязываем
const savedTheme = localStorage.getItem('chelotext-theme');
if (savedTheme === 'dark' || savedTheme === 'light') {
  document.documentElement.dataset.theme = savedTheme;
}
