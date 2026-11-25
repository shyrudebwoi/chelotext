// Отдельный текст согласия на обработку ПДн (ст. 9 152-ФЗ, 156-ФЗ с 01.09.2025).
// Реквизиты оператора пока заглушки — заменяются на реальные до публичного запуска.
import crypto from 'node:crypto';
import { config } from '../config.js';

export function consentDocument() {
  return {
    version: config.policyVersion,
    operator: config.operator.name,
    address: config.operator.address,
    responsible: config.operator.responsible,
    purposes: [
      'регистрация и авторизация в сервисе',
      'обработка загруженных текстов, сохранение истории и правок',
      'исполнение обязанностей оператора по 152-ФЗ (учёт согласий, ответы на обращения)',
    ],
    categories: [
      'адрес электронной почты',
      'пароль в виде криптографического хеша',
      'загруженные тексты, результаты обработки, ревизии и журнал экспорта',
      'IP-адрес, User-Agent, данные сессии и факт согласия',
      'сведения о расходе токенов (llm_usage)',
    ],
    actions: [
      'сбор', 'запись', 'систематизация', 'хранение', 'обработка',
      'передача по поручению', 'блокирование', 'удаление',
    ],
    recipients: [
      'Оператор сервиса «Челотекст» — обработка в собственной базе',
      'GigaChat (Сбербанк) — передача текста для лингвистической обработки',
      'OpenAI-совместимый провайдер или Ollama — при соответствующей настройке сервера',
      'ВКонтакте — передача адресов почты и сведений о расходе токенов администраторам сообщества',
    ],
    retentionDays: config.retentionDays,
    withdrawal: 'в настройках аккаунта: тексты удаляются, факт отзыва сохраняется в журнале согласий',
    crossBorder: config.personalData.localization,
    rknNotice: config.personalData.rknNotice,
    slaDays: config.personalData.subjectRequestSlaDays,
    text: buildText(),
  };
}

function buildText() {
  const doc = consentDocumentMeta();
  return [
    'СОГЛАСИЕ НА ОБРАБОТКУ ПЕРСОНАЛЬНЫХ ДАННЫХ',
    `Версия политики: ${doc.version}. Документ оформлен отдельно от оферты.`,
    `Оператор: ${doc.operator}. Адрес: ${doc.address}.`,
    `Ответственный за обработку: ${doc.responsible}. Почта: ${doc.email}.`,
    `1. Цели обработки: ${doc.purposes.join('; ')}.`,
    `2. Категории данных: ${doc.categories.join('; ')}.`,
    `3. Перечень действий: ${doc.actions}.`,
    `4. Получатели: ${doc.recipients.join('; ')}. Согласие на передачу текста провайдеру даётся отдельной галочкой и может быть отозвано отдельно.`,
    `5. Место обработки: ${doc.localization}.`,
    `6. Срок обработки: по умолчанию ${doc.retentionDays} дней, либо до удаления или отзыва согласия.`,
    `7. Отзыв: ${doc.withdrawal}.`,
    `8. Обращения субъектов: почта ${doc.email}, срок ответа ${doc.slaDays} рабочих дней с правом продления на 5 по закону.`,
    `9. Трансграничная передача: ${doc.crossBorder}.`,
    `10. Уведомление Роскомнадзора: ${doc.rknNotice}.`,
    '11. Подтверждаю, что мне исполнилось 18 лет и я обладаю полной дееспособностью.',
  ].join('\n');
}

function consentDocumentMeta() {
  return {
    version: config.policyVersion,
    operator: config.operator.name,
    address: config.operator.address,
    responsible: config.operator.responsible,
    email: config.operator.email,
    purposes: [
      'регистрация и вход',
      'обработка текстов и показ истории',
      'исполнение обязанностей по 152-ФЗ',
    ],
    categories: [
      'email', 'хеш пароля', 'тексты и результаты, ревизии, экспорт',
      'IP, User-Agent, сессия, факт согласия', 'расход токенов',
    ],
    actions: 'сбор, запись, систематизация, накопление, хранение, уточнение, извлечение, использование, передача, обезличивание, блокирование, удаление',
    recipients: [
      'оператор сервиса',
      'GigaChat',
      'OpenAI-совместимый провайдер или Ollama по настройке сервера',
      'ВКонтакте для отчётов администраторам',
    ],
    localization: config.personalData.localization,
    retentionDays: config.retentionDays,
    withdrawal: 'в настройках аккаунта; уже проведённая до отзыва обработка не прекращается',
    crossBorder: 'при использовании зарубежного провайдера требуется отдельное уведомление РКН по ст. 12 152-ФЗ',
    rknNotice: config.personalData.rknNotice,
    slaDays: config.personalData.subjectRequestSlaDays,
  };
}

export function consentHash(document = consentDocument()) {
  return crypto.createHash('sha256').update(document.text).digest('hex');
}
