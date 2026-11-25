// Главный экран: вставка, настройки, обработка, diff, редактор, экспорт.
import { api, toast, modal, setLoading, formatNumber } from '../app.js';

const MAX_CHARS = Number(document.getElementById('char-counter')?.textContent.split('/')[1].replace(/\D/g, '')) || 100000;

const state = {
  sourceTab: 'paste',
  file: null,
  job: null,
  original: '',
  result: '',
  baseRevision: 0,
  saveTimer: null,
  dirty: false,
  pollTimer: null,
};

const el = {
  text: document.getElementById('source-text'),
  counter: document.getElementById('char-counter'),
  limitError: document.getElementById('limit-error'),
  file: document.getElementById('source-file'),
  fileNote: document.getElementById('file-note'),
  url: document.getElementById('source-url'),
  processBtn: document.getElementById('process-btn'),
  level: document.getElementById('level'),
  levelValue: document.getElementById('level-value'),
  progress: document.getElementById('progress-panel'),
  progressBar: document.getElementById('progress-bar'),
  progressPct: document.getElementById('progress-pct'),
  progressStage: document.getElementById('progress-stage'),
  cancelBtn: document.getElementById('cancel-btn'),
  blocked: document.getElementById('blocked-panel'),
  blockedTitle: document.getElementById('blocked-title'),
  blockedMessage: document.getElementById('blocked-message'),
  blockedEdit: document.getElementById('blocked-edit'),
  result: document.getElementById('result-panel'),
  ocrBanner: document.getElementById('ocr-banner'),
  diffLeft: document.getElementById('diff-left-body'),
  diffRight: document.getElementById('diff-right-body'),
  editor: document.getElementById('result-editor'),
  saveState: document.getElementById('save-state'),
  saveBtn: document.getElementById('save-btn'),
  copyBtn: document.getElementById('copy-btn'),
  integrity: document.getElementById('integrity-badge'),
  stats: document.getElementById('stats-panel'),
};

const LEVEL_NAMES = {
  1: 'Чуть подправить',
  2: 'Полегче',
  3: 'Заметно проще',
  4: 'Сильно проще',
  5: 'Максимально просто',
};

// ---------- Вкладки источника ----------
const tabs = ['paste', 'file', 'url'];
for (const name of tabs) {
  const tab = document.getElementById(`tab-${name}`);
  const panel = document.getElementById(`panel-${name}`);
  tab?.addEventListener('click', () => {
    state.sourceTab = name;
    for (const other of tabs) {
      const t = document.getElementById(`tab-${other}`);
      const p = document.getElementById(`panel-${other}`);
      const active = other === name;
      t.setAttribute('aria-selected', String(active));
      p.classList.toggle('hidden', !active);
    }
    if (name === 'paste') el.text?.focus();
  });
}

// ---------- Вкладки результата ----------
for (const name of ['diff', 'edit']) {
  const tab = document.getElementById(`tab-${name}`);
  const view = document.getElementById(`view-${name}`);
  tab?.addEventListener('click', () => {
    document.getElementById('tab-diff').setAttribute('aria-selected', String(name === 'diff'));
    document.getElementById('tab-edit').setAttribute('aria-selected', String(name === 'edit'));
    document.getElementById('view-diff').classList.toggle('hidden', name !== 'diff');
    document.getElementById('view-edit').classList.toggle('hidden', name !== 'edit');
  });
}

// ---------- Счётчик ----------
function updateCounter() {
  const length = el.text.value.length;
  el.counter.textContent = `${formatNumber(length)} / ${formatNumber(MAX_CHARS)}`;
  el.counter.classList.toggle('is-near', length > MAX_CHARS * 0.9 && length <= MAX_CHARS);
  el.counter.classList.toggle('is-over', length > MAX_CHARS);
  el.limitError.classList.toggle('hidden', length <= MAX_CHARS);
  el.text.setAttribute('aria-invalid', String(length > MAX_CHARS));
  el.processBtn.disabled = length > MAX_CHARS;
}
el.text?.addEventListener('input', updateCounter);
updateCounter();

// ---------- Файл ----------
el.file?.addEventListener('change', () => {
  state.file = el.file.files?.[0] || null;
  if (!state.file) {
    el.fileNote.textContent = '';
    return;
  }
  const sizeMb = (state.file.size / 1024 / 1024).toFixed(1);
  el.fileNote.textContent = `${state.file.name} · ${sizeMb} МБ`;
});

// ---------- Ползунок ----------
function syncLevel() {
  const value = Number(el.level.value);
  el.levelValue.textContent = `${value} · ${LEVEL_NAMES[value]}`;
  const pct = ((value - 1) / 4) * 100;
  el.level.style.setProperty('--slider-pct', `${pct}%`);
}
el.level?.addEventListener('input', syncLevel);
syncLevel();

// ---------- Переключатели ----------
for (const sw of document.querySelectorAll('.switch[data-mode]')) {
  sw.addEventListener('click', () => {
    sw.setAttribute('aria-checked', sw.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
  });
  sw.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      sw.click();
    }
  });
}

const getOptions = () => {
  const modes = {};
  for (const sw of document.querySelectorAll('.switch[data-mode]')) {
    modes[sw.dataset.mode] = sw.getAttribute('aria-checked') === 'true';
  }
  return { ...modes, level: Number(el.level.value) };
};

// ---------- Обработка ----------
el.processBtn?.addEventListener('click', startProcessing);
el.cancelBtn?.addEventListener('click', cancelJob);
el.blockedEdit?.addEventListener('click', () => {
  el.blocked.classList.add('hidden');
  document.getElementById('tab-paste').click();
  el.text.focus();
});

async function startProcessing() {
  el.blocked.classList.add('hidden');
  const options = getOptions();
  if (!options.r1 && !options.r2 && !options.r3) {
    toast('Включи хотя бы один режим', 'warn');
    return;
  }

  setLoading(el.processBtn, true, 'Обрабатываем…');
  try {
    let response;
    if (state.sourceTab === 'file') {
      if (!state.file) {
        setLoading(el.processBtn, false);
        toast('Выбери файл', 'warn');
        return;
      }
      const form = new FormData();
      form.append('file', state.file);
      form.append('r1', String(options.r1));
      form.append('r2', String(options.r2));
      form.append('r3', String(options.r3));
      form.append('level', String(options.level));
      response = await api('/api/process/file', { method: 'POST', body: form });
    } else if (state.sourceTab === 'url') {
      const url = el.url.value.trim();
      if (!url) {
        setLoading(el.processBtn, false);
        toast('Вставь ссылку', 'warn');
        return;
      }
      response = await api('/api/process/url', { method: 'POST', body: JSON.stringify({ url, options }) });
    } else {
      const text = el.text.value;
      if (!text.trim()) {
        setLoading(el.processBtn, false);
        toast('Вставь текст', 'warn');
        return;
      }
      if (text.length > MAX_CHARS) {
        setLoading(el.processBtn, false);
        toast(`Слишком длинно. Убери лишнее — до ${formatNumber(MAX_CHARS)} знаков`, 'error');
        return;
      }
      response = await api('/api/process', { method: 'POST', body: JSON.stringify({ text, options }) });
    }

    if (response.async) {
      window.location.href = `/jobs/${response.job.id}`;
      return;
    }
    showResult(response, state.sourceTab === 'paste' ? el.text.value : '');
  } catch (error) {
    if (error.code === 'consent_required') {
      window.location.href = '/start';
      return;
    }
    if (['illegal', 'copyright', 'tooShort', 'empty'].includes(error.code)) {
      showBlocked(error.data?.title || 'Этот текст мы не можем обработать', error.message);
      return;
    }
    if (error.code === 'rate_limited') {
      toast('Слишком много обработок подряд. Подожди немного', 'warn');
      return;
    }
    toast(error.message, 'error');
  } finally {
    setLoading(el.processBtn, false);
  }
}

function showBlocked(title, message) {
  el.blockedTitle.textContent = title;
  el.blockedMessage.textContent = message;
  el.blocked.classList.remove('hidden');
  el.blocked.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function cancelJob() {
  if (!state.job) return;
  try {
    await api(`/api/jobs/${state.job.id}/cancel`, { method: 'POST' });
    toast('Отменяем…', 'warn');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function showProgress(percent, stage) {
  el.progress.classList.remove('hidden');
  el.progressBar.style.width = `${Math.max(2, percent)}%`;
  el.progressPct.textContent = `${Math.round(percent)}%`;
  el.progressStage.textContent = stage || 'Обрабатываем текст…';
}

// ---------- Результат ----------
async function showResult(response, fallbackOriginal) {
  el.progress.classList.add('hidden');
  el.result.classList.remove('hidden');
  state.job = response.job;
  state.baseRevision = 0;
  state.result = response.job.resultText || '';
  el.editor.value = state.result;
  el.ocrBanner.classList.toggle('hidden', !response.fromOcr);

  // Оригинал: у вставки — то, что ввели; иначе подтянем с сервера.
  let original = fallbackOriginal;
  let diffRows = response.diff?.rows || [];
  if (!original || !diffRows.length) {
    try {
      const data = await api(`/api/jobs/${response.job.id}`);
      original = data.original || fallbackOriginal || '';
      diffRows = data.diffRows || [];
    } catch {
      // остаёмся с тем, что есть
    }
  }
  state.original = original;
  renderDiff(diffRows, original, state.result);
  renderIntegrity(response.integrity);
  renderStats(response.readability);
  bindExports(response.job.id);
  el.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast('Готово', 'success', 3000);
}

function renderDiff(rows, original, result) {
  el.diffLeft.innerHTML = '';
  el.diffRight.innerHTML = '';

  if (!rows || !rows.length) {
    // Фоллбек: построчный показ.
    const leftLines = original.split('\n');
    const rightLines = result.split('\n');
    const max = Math.max(leftLines.length, rightLines.length);
    for (let i = 0; i < max; i += 1) {
      appendDiffLine(el.diffLeft, leftLines[i] ?? '', leftLines[i] === rightLines[i] ? '' : 'removed', !leftLines[i]);
      appendDiffLine(el.diffRight, rightLines[i] ?? '', leftLines[i] === rightLines[i] ? '' : 'added', !rightLines[i]);
    }
    return;
  }

  for (const row of rows) {
    const changed = row.type === 'changed';
    appendDiffLine(el.diffLeft, row.left ?? '', row.type === 'removed' || changed ? 'removed' : '', row.left == null);
    appendDiffLine(el.diffRight, row.right ?? '', row.type === 'added' || changed ? 'added' : '', row.right == null);
  }
}

function appendDiffLine(container, text, className, spacer) {
  const div = document.createElement('div');
  if (spacer) {
    div.className = 'diff__line diff__spacer';
    div.setAttribute('aria-hidden', 'true');
  } else {
    div.className = `diff__line${className ? ` diff__line--${className}` : ''}`;
    div.textContent = text || '\u00a0';
  }
  container.append(div);
}

function renderIntegrity(integrity) {
  if (!integrity) {
    el.integrity.className = 'badge badge--ok';
    el.integrity.innerHTML = '<span>Проверено</span>';
    return;
  }
  const missing =
    (integrity.missing?.numbers?.length || 0) +
    (integrity.missing?.dates?.length || 0) +
    (integrity.missing?.quotes?.length || 0) +
    (integrity.missing?.names?.length || 0);
  if (missing === 0) {
    el.integrity.className = 'badge badge--ok';
    el.integrity.innerHTML = '<span>Числа, даты и имена на месте</span>';
  } else {
    el.integrity.className = 'badge badge--warn';
    el.integrity.innerHTML = `<span>Проверь: ${missing} ${plural(missing, 'деталь', 'детали', 'деталей')} могла измениться</span>`;
    const details = [];
    if (integrity.missing.numbers.length) details.push(`числа: ${integrity.missing.numbers.slice(0, 5).join(', ')}`);
    if (integrity.missing.dates.length) details.push(`даты: ${integrity.missing.dates.slice(0, 5).join(', ')}`);
    if (integrity.missing.names.length) details.push(`имена: ${integrity.missing.names.slice(0, 5).join(', ')}`);
    el.integrity.title = details.join('; ');
  }
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function renderStats(readability) {
  if (!readability) {
    el.stats.innerHTML = '';
    return;
  }
  const { before, after } = readability;
  const delta = before.avgSentenceLength ? Math.round(((before.avgSentenceLength - after.avgSentenceLength) / before.avgSentenceLength) * 100) : 0;
  const num = (value) => Number(value).toLocaleString('ru-RU');
  el.stats.innerHTML = `
    <div class="card card--flat">
      <div class="tiny muted">Средняя длина предложения</div>
      <div style="font-size:22px;font-weight:800">${num(after.avgSentenceLength)} <span class="small muted" style="font-weight:500">слов</span></div>
      <div class="tiny muted">было ${num(before.avgSentenceLength)}</div>
    </div>
    <div class="card card--flat">
      <div class="tiny muted">Канцелярит</div>
      <div style="font-size:22px;font-weight:800">${num(after.bureaucracy)} <span class="small muted" style="font-weight:500">слов</span></div>
      <div class="tiny muted">было ${num(before.bureaucracy)}</div>
    </div>
    <div class="card card--flat">
      <div class="tiny muted">Объём</div>
      <div style="font-size:22px;font-weight:800">${formatNumber(after.words)} <span class="small muted" style="font-weight:500">слов</span></div>
      <div class="tiny muted">было ${formatNumber(before.words)} · текст не сокращён</div>
    </div>`;
}

// ---------- Редактор ----------
el.editor?.addEventListener('input', () => {
  state.dirty = true;
  state.result = el.editor.value;
  el.saveState.className = 'badge badge--warn';
  el.saveState.textContent = 'Есть несохранённые правки';
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => saveRevision(true), 10000);
});

el.saveBtn?.addEventListener('click', () => saveRevision(false));

async function saveRevision(silent) {
  if (!state.job || !state.dirty) {
    if (!silent) toast('Нечего сохранять', 'warn');
    return;
  }
  try {
    const data = await api(`/api/jobs/${state.job.id}/revisions`, {
      method: 'POST',
      body: JSON.stringify({ text: el.editor.value, baseRevision: state.baseRevision }),
    });
    state.baseRevision = data.revision;
    state.dirty = false;
    el.saveState.className = 'badge badge--ok';
    el.saveState.textContent = 'Сохранено';
    if (!silent) toast('Готово, сохранили', 'success', 2500);
  } catch (error) {
    if (error.code === 'conflict') {
      el.saveState.className = 'badge badge--err';
      el.saveState.textContent = 'Правки в другой вкладке';
      toast('Текст уже правили в другой вкладке. Обнови страницу, чтобы не потерять правки', 'error', 8000);
      return;
    }
    if (!silent) toast(error.message, 'error');
  }
}

// Ctrl/Cmd+S
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    if (!el.result.classList.contains('hidden')) {
      event.preventDefault();
      saveRevision(false);
    }
  }
});

// Сохранение при уходе со страницы
window.addEventListener('beforeunload', (event) => {
  if (state.dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});

// ---------- Экспорт ----------
function bindExports(jobId) {
  for (const format of ['txt', 'md', 'pdf', 'docx', 'html']) {
    const link = document.getElementById(`download-${format}`);
    if (link) link.href = `/api/jobs/${jobId}/export/${format}`;
  }
}

el.copyBtn?.addEventListener('click', async () => {
  const text = el.editor.value || state.result;
  try {
    await navigator.clipboard.writeText(text);
    toast('Скопировали', 'success', 2500);
  } catch {
    // Фоллбек для старых браузеров
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    toast('Скопировали', 'success', 2500);
  }
});

// ---------- История правок ----------
document.getElementById('revisions-btn')?.addEventListener('click', async () => {
  if (!state.job) return;
  try {
    const data = await api(`/api/jobs/${state.job.id}/revisions`);
    if (!data.items.length) {
      toast('Правок пока нет', 'warn');
      return;
    }
    const list = data.items
      .slice(0, 10)
      .map((item) => `#${item.revision} — ${new Date(item.createdAt).toLocaleString('ru-RU')} (${formatNumber(item.chars)} знаков)`)
      .join('\n');
    const ok = await modal({
      title: 'История правок',
      text: `${list}\n\nЗагрузить последнюю сохранённую версию?`,
      confirmLabel: 'Загрузить',
      danger: false,
    });
    if (ok) {
      const latest = data.items[0];
      const rev = await api(`/api/jobs/${state.job.id}/revisions/${latest.revision}`);
      el.editor.value = rev.revision.text;
      state.dirty = false;
      state.baseRevision = rev.revision.revision;
      el.saveState.className = 'badge badge--ok';
      el.saveState.textContent = 'Сохранено';
      toast('Загрузили последнюю версию', 'success');
    }
  } catch (error) {
    toast(error.message, 'error');
  }
});

// Восстановление из истории: ?job=123
const params = new URLSearchParams(location.search);
const jobParam = params.get('job');
if (jobParam) {
  (async () => {
    try {
      const data = await api(`/api/jobs/${jobParam}`);
      if (data.job?.status === 'done') {
        showResult({ job: data.job, diff: data.diff, integrity: data.job.integrity }, data.original || '');
      } else if (data.job) {
        window.location.href = `/jobs/${data.job.id}`;
      }
    } catch (error) {
      toast(error.message, 'error');
    }
  })();
}
