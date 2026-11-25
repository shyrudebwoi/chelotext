// Экран асинхронной задачи: прогресс, отмена, автопереход в редактор.
import { api, toast } from '../app.js';

const jobId = Number(location.pathname.split('/').filter(Boolean).pop());
const STAGE_LABELS = {
  queued: 'В очереди',
  start: 'Готовимся',
  extract: 'Читаю файл',
  ocr: 'Распознаю скан',
  precheck: 'Проверяю текст',
  rules: 'Причёсываю формулировки',
  llm: 'Упрощаю язык',
  assemble: 'Собираю результат',
  integrity: 'Проверяю, что всё на месте',
  done: 'Готово',
  failed: 'Не получилось',
  cancelled: 'Отменено',
};

const el = {
  title: document.getElementById('job-title'),
  subtitle: document.getElementById('job-subtitle'),
  stage: document.getElementById('job-stage'),
  pct: document.getElementById('job-pct'),
  bar: document.getElementById('job-bar'),
  stages: document.getElementById('job-stages'),
  cancel: document.getElementById('job-cancel'),
  open: document.getElementById('job-open'),
  error: document.getElementById('job-error'),
  errorText: document.getElementById('job-error-text'),
};

let timer = null;
let cancelled = false;

async function poll() {
  try {
    const data = await api(`/api/jobs/${jobId}`);
    const job = data.job;
    const stageLabel = STAGE_LABELS[job.stage] || STAGE_LABELS[job.status] || 'Обрабатываем';
    el.stage.textContent = stageLabel;
    el.pct.textContent = `${job.progress}%`;
    el.bar.style.width = `${Math.max(2, job.progress)}%`;

    // Подсветка этапов
    const order = ['queued', 'extract', 'ocr', 'precheck', 'rules', 'llm', 'assemble', 'done'];
    const currentIndex = order.indexOf(job.stage);
    for (const li of el.stages.querySelectorAll('li')) {
      const index = order.indexOf(li.dataset.stage);
      li.classList.toggle('is-active', index === currentIndex);
      li.classList.toggle('is-done', currentIndex > index || job.status === 'done');
    }

    if (job.status === 'done') {
      clearInterval(timer);
      el.title.textContent = 'Готово';
      el.subtitle.textContent = 'Открываем результат в редакторе…';
      el.cancel.classList.add('hidden');
      el.open.classList.remove('hidden');
      el.open.href = `/app?job=${job.id}`;
      setTimeout(() => {
        window.location.href = `/app?job=${job.id}`;
      }, 1200);
      return;
    }
    if (job.status === 'failed') {
      clearInterval(timer);
      el.title.textContent = 'Не получилось';
      el.cancel.classList.add('hidden');
      el.error.classList.remove('hidden');
      el.errorText.textContent = job.errorMessage || 'Попробуй загрузить файл ещё раз';
      return;
    }
    if (job.status === 'cancelled') {
      clearInterval(timer);
      el.title.textContent = 'Отменили';
      el.subtitle.textContent = 'Задача остановлена. Можно загрузить другой текст.';
      el.cancel.classList.add('hidden');
      el.stage.textContent = 'Отменено';
      return;
    }
  } catch (error) {
    if (error.status === 404) {
      clearInterval(timer);
      el.title.textContent = 'Задача не найдена';
      el.subtitle.textContent = 'Возможно, её удалили.';
      el.cancel.classList.add('hidden');
      return;
    }
  }
}

el.cancel.addEventListener('click', async () => {
  if (cancelled) return;
  cancelled = true;
  el.cancel.disabled = true;
  el.cancel.textContent = 'Отменяем…';
  try {
    await api(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
    toast('Останавливаем задачу', 'warn');
    poll();
  } catch (error) {
    toast(error.message, 'error');
    el.cancel.disabled = false;
    el.cancel.textContent = 'Отменить';
  }
});

poll();
timer = setInterval(poll, 1500);
