// Согласие на обработку ПДн.
import { api, setLoading, toast } from '../app.js';

const form = document.getElementById('consent-form');
if (form) {
  const checkbox = document.getElementById('consent-checkbox');
  const submit = document.getElementById('consent-submit');
  const error = document.getElementById('consent-error');

  const sync = () => {
    submit.disabled = !checkbox.checked;
    if (checkbox.checked) error.classList.add('hidden');
  };
  checkbox.addEventListener('change', sync);
  sync();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!checkbox.checked) {
      error.classList.remove('hidden');
      checkbox.focus();
      return;
    }
    setLoading(submit, true, 'Сохраняем…');
    try {
      await api('/api/auth/consent', {
        method: 'POST',
        body: JSON.stringify({ action: 'grant' }),
      });
      window.location.href = '/app';
    } catch (error_) {
      setLoading(submit, false);
      toast(error_.message, 'error');
    }
  });
}
