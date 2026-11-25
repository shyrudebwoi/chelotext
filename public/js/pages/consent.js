// Отдельное согласие на обработку ПДн + подтверждение возраста и передачи текста.
import { api, setLoading, toast } from '../app.js';

const form = document.getElementById('consent-form');
if (form) {
  const consent = document.getElementById('consent-checkbox');
  const age = document.getElementById('age-checkbox');
  const thirdParty = document.getElementById('third-party-checkbox');
  const submit = document.getElementById('consent-submit');
  const error = document.getElementById('consent-error');

  const sync = () => {
    submit.disabled = !(consent.checked && age.checked);
    if (consent.checked && age.checked) error.classList.add('hidden');
  };
  for (const box of [consent, age, thirdParty]) box.addEventListener('change', sync);
  sync();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!consent.checked || !age.checked) {
      error.classList.remove('hidden');
      (!consent.checked ? consent : age).focus();
      return;
    }
    setLoading(submit, true, 'Сохраняем…');
    try {
      await api('/api/auth/consent', {
        method: 'POST',
        body: JSON.stringify({
          action: 'grant',
          ageConfirmed: true,
          thirdPartyConsent: thirdParty.checked,
          policyVersion: submit.dataset.policyVersion || undefined,
        }),
      });
      window.location.href = '/app';
    } catch (error_) {
      setLoading(submit, false);
      toast(error_.message, 'error');
    }
  });
}
