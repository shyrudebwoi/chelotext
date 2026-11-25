// Форма обращения субъекта ПДн: отправка в API и проверка статуса по номеру.
import { api, toast, setLoading } from '../app.js';

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const form = document.getElementById('pd-form');
if (form) {
  const submit = document.getElementById('pd-submit');
  const result = document.getElementById('pd-result');
  const statusForm = document.getElementById('pd-status-form');
  const statusResult = document.getElementById('pd-status-result');

  const renderResult = (host, html) => {
    host.classList.remove('hidden');
    host.innerHTML = html;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = document.getElementById('pd-name').value.trim();
    const email = document.getElementById('pd-email').value.trim();
    const kind = document.getElementById('pd-kind').value;
    const comment = document.getElementById('pd-comment').value.trim();
    if (!name || !email) {
      toast('Заполни имя и почту', 'warn');
      return;
    }
    setLoading(submit, true, 'Отправляем…');
    try {
      const data = await api('/api/pd/request', {
        method: 'POST',
        body: JSON.stringify({ name, email, kind, comment }),
      });
      const due = new Date(data.dueAt).toLocaleDateString('ru-RU');
      renderResult(result, `<p class="mb-0"><strong>Обращение принято.</strong> Номер: <code>${escapeHtml(data.ticket)}</code>. Ответим до ${escapeHtml(due)}. Сохрани номер — по нему и почте можно проверить статус ниже.</p>`);
      form.reset();
      document.getElementById('pd-status-ticket').value = data.ticket;
      document.getElementById('pd-status-email').value = email;
      toast('Обращение принято', 'success');
    } catch (error_) {
      toast(error_.message, 'error');
    } finally {
      setLoading(submit, false);
    }
  });

  statusForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const ticket = document.getElementById('pd-status-ticket').value.trim();
    const email = document.getElementById('pd-status-email').value.trim();
    if (!ticket || !email) {
      toast('Укажи номер и почту', 'warn');
      return;
    }
    try {
      const data = await api(`/api/pd/request/${encodeURIComponent(ticket)}?email=${encodeURIComponent(email)}`);
      const request = data.request;
      renderResult(
        statusResult,
        `<p class="mb-0">Обращение <code>${escapeHtml(request.publicId)}</code>: ${escapeHtml(request.status)}. Срок ответа до ${escapeHtml(new Date(request.dueAt).toLocaleDateString('ru-RU'))}.</p>`,
      );
    } catch (error_) {
      toast(error_.message, 'error');
    }
  });
}
