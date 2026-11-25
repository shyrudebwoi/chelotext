// Форма обращения субъекта ПДн: собирает текст письма, чтобы отправить вручную.
import { toast } from '../app.js';

const form = document.getElementById('pd-form');
form?.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = document.getElementById('pd-name').value.trim();
  const email = document.getElementById('pd-email').value.trim();
  const kind = document.getElementById('pd-kind').value;
  const comment = document.getElementById('pd-comment').value.trim();
  if (!name || !email) {
    toast('Заполни имя и почту', 'warn');
    return;
  }
  const labels = {
    access: 'Узнать, какие данные хранятся',
    delete: 'Удалить данные',
    revoke: 'Отозвать согласие',
    other: 'Другое',
  };
  const text = `Обращение субъекта ПДн\n\nИмя: ${name}\nПочта: ${email}\nЧто нужно: ${labels[kind]}\n\n${comment}`;
  navigator.clipboard?.writeText(text).then(
    () => toast('Текст обращения скопирован. Отправь его на почту оператора', 'success', 8000),
    () => toast('Скопируй текст вручную и отправь на почту оператора', 'warn', 8000),
  );
});
