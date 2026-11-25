// Настройки: согласие, срок хранения, экспорт данных, удаление аккаунта.
import { api, toast, modal, formatDate } from '../app.js';

const status = document.getElementById('consent-status');
const infoLlm = document.getElementById('info-llm');
const infoOcr = document.getElementById('info-ocr');

async function load() {
  try {
    const data = await api('/api/settings');
    if (status) {
      status.innerHTML = data.consentRequired
        ? '<span class="badge badge--warn">Согласие не дано</span>'
        : `<span class="badge badge--ok">Согласие дано</span> <span class="small muted">${data.user.consentAt ? formatDate(data.user.consentAt) : ''}</span>`;
    }
    if (infoLlm) {
      infoLlm.textContent = data.llm.enabled ? `${data.llm.provider} · ${data.llm.model}` : 'только правила (модель выключена)';
    }
    if (infoOcr) {
      infoOcr.textContent = data.ocr.enabled ? `включён · ${data.ocr.languages.join('+')}` : 'выключен';
    }
  } catch (error) {
    toast(error.message, 'error');
  }
}

document.getElementById('revoke-consent')?.addEventListener('click', async () => {
  const ok = await modal({
    title: 'Отозвать согласие?',
    text: 'Если отзовёшь согласие, мы удалим все твои тексты и результаты. Это не вернуть.',
    confirmLabel: 'Отозвать и удалить',
  });
  if (!ok) return;
  try {
    await api('/api/auth/consent', { method: 'POST', body: JSON.stringify({ action: 'revoke' }) });
    toast('Согласие отозвано, тексты удалены', 'success');
    setTimeout(() => (window.location.href = '/start'), 1200);
  } catch (error) {
    toast(error.message, 'error');
  }
});

document.getElementById('save-retention')?.addEventListener('click', async () => {
  const days = Number(document.getElementById('retention-days').value);
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    toast('Срок — от 1 до 365 дней', 'warn');
    return;
  }
  try {
    await api('/api/settings/retention', { method: 'POST', body: JSON.stringify({ days }) });
    toast('Сохранили', 'success', 2500);
  } catch (error) {
    toast(error.message, 'error');
  }
});

document.getElementById('purge-now')?.addEventListener('click', async () => {
  const ok = await modal({
    title: 'Удалить старое сейчас?',
    text: 'Удалим тексты старше выбранного срока. Это не вернуть.',
    confirmLabel: 'Удалить',
  });
  if (!ok) return;
  try {
    const result = await api('/api/settings/purge', { method: 'POST' });
    toast(`Удалили: текстов ${result.documents}, задач ${result.jobs}`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
});

document.getElementById('delete-account')?.addEventListener('click', async () => {
  const ok = await modal({
    title: 'Удалить аккаунт?',
    text: 'Удалим аккаунт и все тексты. Восстановить нельзя.',
    confirmLabel: 'Удалить навсегда',
  });
  if (!ok) return;
  try {
    await api('/api/auth/account', { method: 'DELETE', body: JSON.stringify({ confirm: 'УДАЛИТЬ' }) });
    toast('Аккаунт удалён', 'success');
    setTimeout(() => (window.location.href = '/'), 900);
  } catch (error) {
    toast(error.message, 'error');
  }
});

document.getElementById('export-json')?.addEventListener('click', async () => {
  try {
    const [settings, documents, jobs] = await Promise.all([
      api('/api/settings'),
      api('/api/documents?limit=100'),
      api('/api/jobs?limit=100'),
    ]);
    const blob = new Blob(
      [JSON.stringify({ exportedAt: new Date().toISOString(), settings, documents: documents.items, jobs: jobs.items }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chelotext-data.json';
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    toast(error.message, 'error');
  }
});

load();
