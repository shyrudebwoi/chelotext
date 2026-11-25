// Регистрация и вход.
import { api, setLoading, toast } from '../app.js';

const showError = (name, message) => {
  const el = document.querySelector(`[data-error-for="${name}"]`);
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  const input = document.getElementById(name);
  if (input) input.setAttribute('aria-invalid', 'true');
};

const clearErrors = (form) => {
  form.querySelectorAll('[data-error-for]').forEach((el) => {
    el.textContent = '';
    el.classList.add('hidden');
  });
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
};

const form = document.getElementById('login-form') || document.getElementById('register-form');
if (form) {
  const isRegister = form.id === 'register-form';
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    const email = form.querySelector('#email').value.trim();
    const password = form.querySelector('#password').value;
    if (!email) return showError('email', 'Укажи почту');
    if (!password) return showError('password', 'Введи пароль');
    if (isRegister && password.length < 8) return showError('password', 'Пароль короче 8 символов');

    const button = form.querySelector('button[type="submit"]');
    setLoading(button, true, isRegister ? 'Создаём…' : 'Входим…');
    try {
      await api(isRegister ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      window.location.href = isRegister ? '/start' : '/app';
    } catch (error) {
      setLoading(button, false);
      if (error.code === 'email_taken') return showError('email', 'Такая почта уже занята');
      if (error.code === 'invalid_credentials') return showError('password', 'Почта или пароль не подошли');
      if (error.code === 'rate_limited') return toast('Слишком много попыток. Подожди немного', 'warn');
      if (error.code === 'invalid_password') return showError('password', error.message);
      toast(error.message, 'error');
    }
  });
}
