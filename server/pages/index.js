// Страницы (SSR). Интерактивность — в /public/js/pages/*.js.
import { config } from '../config.js';
import { icon, illustration, esc } from '../render.js';

const nav = (user) => user;

// ---------- Лендинг ----------
function landing({ user }) {
  const body = `
<section class="hero">
  <div class="container hero__inner">
    <div>
      <h1>Тот же текст.<br>Читать легче.</h1>
      <p class="hero__lead">Челотекст меняет подачу: короткие абзацы, простые слова, понятная структура. Смысл, факты, имена и числа остаются на месте — мы не сокращаем.</p>
      <div class="hero__actions">
        <a class="btn btn--lg" href="${user ? '/app' : '/start'}">${user ? 'Вставить текст' : 'Начать'}</a>
        <a class="btn btn--lg btn--secondary" href="#how">Как это работает</a>
      </div>
      <p class="hero__note">Бесплатно. Без рекламы. Твой текст видишь только ты.</p>
    </div>
    <div class="hero__art">${illustration('reading', 'hero__illustration')}</div>
  </div>
</section>

<section class="section section--soft" id="how">
  <div class="container">
    <div class="section__head">
      <h2>Три режима — включай что нужно</h2>
      <p class="muted">Каждый работает отдельно. Можно всё сразу, можно только одно.</p>
    </div>
    <div class="grid grid--3">
      <article class="mode-card">
        <div class="mode-card__icon">${icon('layout', 22)}</div>
        <h3>Красивее оформить</h3>
        <p>Огромные абзацы делятся на части. Появляются заголовки, воздух и ровные интервалы.</p>
      </article>
      <article class="mode-card">
        <div class="mode-card__icon">${icon('language', 22)}</div>
        <h3>Простым языком</h3>
        <p>Убираем канцелярит и лишние обороты, режем длинные предложения. Без потери смысла.</p>
      </article>
      <article class="mode-card">
        <div class="mode-card__icon">${icon('list', 22)}</div>
        <h3>Навести порядок</h3>
        <p>Главные мысли становятся видны. Перечисления превращаются в списки, заголовки — в заголовки.</p>
      </article>
    </div>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="grid grid--2" style="align-items:start">
      <div>
        <h2>Что умеет</h2>
        <ul class="checklist mt-6">
          <li>${icon('check')}<span>Вставить текст из буфера — до 100 000 знаков</span></li>
          <li>${icon('check')}<span>Загрузить файл: TXT, MD, DOCX или PDF</span></li>
          <li>${icon('check')}<span>Сканы распознаём: PDF без текстового слоя читаем через OCR</span></li>
          <li>${icon('check')}<span>Открыть статью по ссылке</span></li>
          <li>${icon('check')}<span>Сравнить «было» и «стало» с подсветкой изменений</span></li>
          <li>${icon('check')}<span>Поправить руками и скачать в TXT, PDF, Markdown, DOCX или HTML</span></li>
          <li>${icon('check')}<span>Вернуться к любому тексту из истории</span></li>
        </ul>
      </div>
      <div class="card">
        <h3 class="card__title">Что мы не делаем</h3>
        <ul class="checklist">
          <li>${icon('shield')}<span>Не сокращаем содержание и не пересказываем</span></li>
          <li>${icon('shield')}<span>Не меняем числа, даты, имена и цитаты</span></li>
          <li>${icon('shield')}<span>Не обрабатываем чужие авторские тексты целиком</span></li>
          <li>${icon('shield')}<span>Не отдаём твои тексты кому попало</span></li>
        </ul>
        <p class="small muted mt-6 mb-0">Научные статьи обрабатываем — их можно.</p>
      </div>
    </div>
  </div>
</section>

<section class="section cta">
  <div class="container">
    <div class="cta__box">
      <h2>Вставь свой текст — посмотри, как станет</h2>
      <p class="muted" style="max-width:34em;margin:0 auto var(--s-8)">Первый результат за несколько секунд. Дальше можно править и скачивать.</p>
      <a class="btn btn--lg" href="${user ? '/app' : '/start'}">${user ? 'Вставить текст' : 'Начать бесплатно'}</a>
    </div>
  </div>
</section>`;
  return {
    title: 'Текст, который легко читать',
    description: 'Челотекст делает текст легче для чтения: короткие абзацы, простой язык, понятная структура. Смысл, факты и числа сохраняются.',
    body,
  };
}

// ---------- Онбординг + согласие ----------
function start({ user }) {
  if (!user) {
    const body = `
<section class="section">
  <div class="container" style="max-width:760px">
    <h1>Начнём</h1>
    <p class="muted" style="font-size:19px">Сначала пара шагов: короткое объяснение, согласие и вход. Это минута.</p>
    <div class="card mt-8">
      <h3 class="card__title">Как это работает</h3>
      <ul class="checklist">
        <li>${icon('file')}<span>Ты вставляешь текст или загружаешь файл.</span></li>
        <li>${icon('sparkle')}<span>Мы переделываем подачу: абзацы, язык, структура.</span></li>
        <li>${icon('copy')}<span>Ты правишь результат и копируешь или скачиваешь.</span></li>
      </ul>
      <div class="banner banner--info mt-6">
        ${icon('shield')}
        <div>
          <div class="banner__title">Что происходит с текстом</div>
          <p>Текст хранится в твоём аккаунте, пока ты сам не удалишь его или не отзовёшь согласие. Мы не публикуем его и не показываем другим.</p>
        </div>
      </div>
      <a class="btn btn--lg btn--block mt-6" href="/register">Продолжить</a>
      <p class="small muted text-center mt-4 mb-0">Уже есть аккаунт? <a href="/login">Войти</a></p>
    </div>
  </div>
</section>`;
    return { title: 'Начать', body };
  }

  const body = `
<section class="section">
  <div class="container" style="max-width:760px">
    <h1>Один шаг — и можно работать</h1>
    <p class="muted" style="font-size:19px">Нужно твоё согласие на обработку данных. Без него сервис не сможет обработать текст.</p>
    <form class="card mt-8" id="consent-form" novalidate>
      <h3 class="card__title">Согласие на обработку персональных данных</h3>
      <p class="small">Я согласен на обработку моих данных: адреса почты и текстов, которые я загружаю. Данные нужны, чтобы сервис работал.</p>
      <ul class="small muted">
        <li>Оператор: ${esc(config.operator.name)}</li>
        <li>Версия политики: ${esc(config.policyVersion)}</li>
        <li>Хранение: ${config.retentionDays} дней, если не удалить раньше</li>
      </ul>
      <label class="row" style="align-items:flex-start;gap:12px;margin:var(--s-6) 0">
        <input type="checkbox" id="consent-checkbox" name="consent" style="width:22px;height:22px;margin-top:2px;accent-color:#0F766E">
        <span>Я прочитал и согласен с <a href="/legal/privacy" target="_blank" rel="noopener">политикой обработки данных</a> и <a href="/legal/terms" target="_blank" rel="noopener">офертой</a>.</span>
      </label>
      <p class="field__error hidden" id="consent-error" role="alert">${icon('alert', 16)}<span>Без согласия не получится — поставь галочку.</span></p>
      <button class="btn btn--lg btn--block" type="submit" id="consent-submit" disabled>Продолжить</button>
      <p class="small muted text-center mt-4 mb-0">Согласие можно отозвать в любой момент в <a href="/settings">настройках</a>. Тогда мы удалим твои тексты.</p>
    </form>
  </div>
</section>`;
  return { title: 'Согласие', body, scripts: ['/js/pages/consent.js'] };
}

// ---------- Вход и регистрация ----------
function login() {
  const body = `
<section class="section">
  <div class="container" style="max-width:440px">
    <h1>Вход</h1>
    <p class="muted">Рад видеть снова.</p>
    <form class="card mt-6" id="login-form" novalidate>
      <label class="field">
        <span class="field__label">Почта</span>
        <input class="input" type="email" name="email" id="email" autocomplete="email" required>
        <span class="field__error hidden" data-error-for="email"></span>
      </label>
      <label class="field">
        <span class="field__label">Пароль</span>
        <input class="input" type="password" name="password" id="password" autocomplete="current-password" required>
        <span class="field__error hidden" data-error-for="password"></span>
      </label>
      <button class="btn btn--lg btn--block" type="submit">Войти</button>
      <p class="small muted text-center mt-4 mb-0">Нет аккаунта? <a href="/register">Зарегистрироваться</a></p>
    </form>
  </div>
</section>`;
  return { title: 'Вход', body, scripts: ['/js/pages/auth.js'] };
}

function register() {
  const body = `
<section class="section">
  <div class="container" style="max-width:440px">
    <h1>Регистрация</h1>
    <p class="muted">Почта и пароль — и всё.</p>
    <form class="card mt-6" id="register-form" novalidate>
      <label class="field">
        <span class="field__label">Почта</span>
        <input class="input" type="email" name="email" id="email" autocomplete="email" required>
        <span class="field__hint">На неё придёт вход. Спама не будет.</span>
        <span class="field__error hidden" data-error-for="email"></span>
      </label>
      <label class="field">
        <span class="field__label">Пароль</span>
        <input class="input" type="password" name="password" id="password" autocomplete="new-password" required minlength="${config.limits.minPassword}">
        <span class="field__hint">Минимум ${config.limits.minPassword} символов.</span>
        <span class="field__error hidden" data-error-for="password"></span>
      </label>
      <button class="btn btn--lg btn--block" type="submit">Создать аккаунт</button>
      <p class="small muted text-center mt-4 mb-0">Уже есть аккаунт? <a href="/login">Войти</a></p>
      <p class="tiny muted text-center mt-4 mb-0">Создавая аккаунт, ты соглашаешься с <a href="/legal/terms">офертой</a>. Согласие на обработку данных спросим отдельно.</p>
    </form>
  </div>
</section>`;
  return { title: 'Регистрация', body, scripts: ['/js/pages/auth.js'] };
}

// ---------- Главный экран ----------
function appPage({ user }) {
  if (!user) return { redirect: '/start' };
  if (user.consentStatus !== 'granted') return { redirect: '/start' };

  const body = `
<section class="section" style="padding-top:var(--s-6)">
  <div class="container">
    <div class="row row--between mb-6">
      <div>
        <h1 style="margin-bottom:var(--s-1)">Вставь текст</h1>
        <p class="muted mb-0">До ${config.limits.maxChars.toLocaleString('ru-RU')} знаков. Режимы можно менять как хочешь.</p>
      </div>
      <a class="btn btn--secondary btn--sm" href="/history">${icon('history', 16)}<span>История</span></a>
    </div>

    <div class="workspace">
    <div class="workspace__source">
    <div class="tabs" role="tablist" aria-label="Откуда взять текст">
      <button class="tab" role="tab" id="tab-paste" aria-controls="panel-paste" aria-selected="true">Вставить текст</button>
      <button class="tab" role="tab" id="tab-file" aria-controls="panel-file" aria-selected="false">Файл</button>
      <button class="tab" role="tab" id="tab-url" aria-controls="panel-url" aria-selected="false">Ссылка</button>
    </div>

    <div id="panel-paste" role="tabpanel" aria-labelledby="tab-paste">
      <label class="sr-only" for="source-text">Текст для обработки</label>
      <textarea class="textarea" id="source-text" rows="9" placeholder="Вставь сюда текст — статью, документ, пост. Мы сделаем его легче для чтения." aria-describedby="counter-hint"></textarea>
      <div class="counter">
        <span id="counter-hint" class="tiny">Считаем знаки</span>
        <span class="counter__value" id="char-counter" aria-live="polite">0 / ${config.limits.maxChars.toLocaleString('ru-RU')}</span>
      </div>
      <p class="field__error hidden" id="limit-error" role="alert">${icon('alert', 16)}<span>Слишком длинно. Убери лишнее.</span></p>
    </div>

    <div id="panel-file" role="tabpanel" aria-labelledby="tab-file" class="hidden">
      <div class="card card--flat" style="border-style:dashed">
        <label class="field mb-0">
          <span class="field__label">Файл: TXT, MD, DOCX или PDF</span>
          <input class="input" type="file" id="source-file" accept=".txt,.md,.markdown,.docx,.pdf,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
          <span class="field__hint">PDF до ${config.limits.maxPdfPages} страниц. Сканы распознаём — это займёт время.</span>
        </label>
        <p class="tiny muted mt-4 mb-0" id="file-note"></p>
      </div>
    </div>

    <div id="panel-url" role="tabpanel" aria-labelledby="tab-url" class="hidden">
      <label class="field">
        <span class="field__label">Ссылка на статью или пост</span>
        <input class="input" type="url" id="source-url" placeholder="https://example.com/article" inputmode="url">
        <span class="field__hint">Достанем текст и обработаем как обычно.</span>
      </label>
    </div>

    </div>
    <aside class="workspace__settings card" aria-label="Настройки обработки">
      <h2 class="card__title">Настройки</h2>
      <div id="mode-switches">
        <div class="switch-row">
          <div class="switch-row__text">
            <div class="switch-row__title">Красивее оформить</div>
            <div class="switch-row__desc">Абзацы, заголовки, отступы</div>
          </div>
          <button class="switch" role="switch" aria-checked="true" aria-label="Красивее оформить" data-mode="r1"></button>
        </div>
        <div class="switch-row">
          <div class="switch-row__text">
            <div class="switch-row__title">Простым языком</div>
            <div class="switch-row__desc">Убрать сложное и канцелярское</div>
          </div>
          <button class="switch" role="switch" aria-checked="true" aria-label="Простым языком" data-mode="r2"></button>
        </div>
        <div class="switch-row">
          <div class="switch-row__text">
            <div class="switch-row__title">Навести порядок</div>
            <div class="switch-row__desc">Заголовки, списки, главное</div>
          </div>
          <button class="switch" role="switch" aria-checked="true" aria-label="Навести порядок" data-mode="r3"></button>
        </div>
      </div>

      <div class="slider mt-4">
        <div class="slider__head">
          <label class="field__label mb-0" for="level">Глубина правки</label>
          <span class="slider__value" id="level-value">3 · Заметно проще</span>
        </div>
        <div class="slider__track">
          <input type="range" id="level" min="1" max="5" step="1" value="3" aria-describedby="level-labels">
          <div class="slider__ticks" aria-hidden="true"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div>
        </div>
        <div class="slider__labels" id="level-labels"><span>полегче</span><span>поглубже</span></div>
      </div>

      <div class="row mt-4">
        <button class="btn btn--lg grow" id="process-btn" type="button">Обработать</button>
      </div>
      <p class="tiny muted mt-3 mb-0">Текст передаётся модели только если она включена. По умолчанию работают правила — текст никуда не уходит.</p>
    </aside>
    </div>

    <div id="progress-panel" class="card mt-6 hidden" aria-live="polite">
      <div class="row row--between mb-4">
        <strong id="progress-stage">Обрабатываем текст…</strong>
        <span class="badge" id="progress-pct">0%</span>
      </div>
      <div class="progress"><div class="progress__bar" id="progress-bar"></div></div>
      <div class="row mt-4">
        <button class="btn btn--secondary btn--sm" id="cancel-btn" type="button">Отменить</button>
      </div>
    </div>

    <div id="blocked-panel" class="banner banner--err mt-6 hidden" role="alert">
      ${icon('alert')}
      <div>
        <div class="banner__title" id="blocked-title">Этот текст мы не можем обработать</div>
        <p id="blocked-message"></p>
        <div class="banner__actions"><button class="btn btn--secondary btn--sm" id="blocked-edit" type="button">Изменить текст</button></div>
      </div>
    </div>

    <div id="result-panel" class="result-panel hidden">
      <div class="result-toolbar">
        <div class="row">
          <h2 class="mb-0" style="font-size:24px">Результат</h2>
          <span class="badge badge--ok" id="integrity-badge">${icon('check', 14)}<span>Всё на месте</span></span>
        </div>
        <div class="export-row">
          <button class="btn btn--ghost btn--sm" id="copy-btn" type="button">${icon('copy', 16)}<span>Копировать</span></button>
          <a class="btn btn--secondary btn--sm" id="download-txt" href="#">TXT</a>
          <a class="btn btn--secondary btn--sm" id="download-md" href="#">Markdown</a>
          <a class="btn btn--secondary btn--sm" id="download-pdf" href="#">PDF</a>
          <a class="btn btn--secondary btn--sm" id="download-docx" href="#">DOCX</a>
          <a class="btn btn--secondary btn--sm" id="download-html" href="#">HTML</a>
        </div>
      </div>

      <div id="ocr-banner" class="banner banner--warn hidden">
        ${icon('alert')}
        <div>
          <div class="banner__title">Текст распознан автоматически</div>
          <p>Возможны ошибки распознавания. Проверь и поправь в редакторе.</p>
        </div>
      </div>

      <div class="tabs" role="tablist" aria-label="Вид результата">
        <button class="tab" role="tab" id="tab-diff" aria-controls="view-diff" aria-selected="true">Сравнить</button>
        <button class="tab" role="tab" id="tab-edit" aria-controls="view-edit" aria-selected="false">Редактор</button>
      </div>

      <div id="view-diff" role="tabpanel" aria-labelledby="tab-diff">
        <div class="diff" id="diff">
          <div class="diff__col" id="diff-left">
            <div class="diff__head">Было</div>
            <div class="diff__body" id="diff-left-body"></div>
          </div>
          <div class="diff__col" id="diff-right">
            <div class="diff__head">Стало</div>
            <div class="diff__body" id="diff-right-body"></div>
          </div>
        </div>
        <div class="diff__legend">
          <span><i class="diff__swatch diff__swatch--del"></i>убрали</span>
          <span><i class="diff__swatch diff__swatch--add"></i>добавили или изменили</span>
          <span><i class="diff__swatch diff__swatch--mark"></i>главное</span>
        </div>
      </div>

      <div id="view-edit" role="tabpanel" aria-labelledby="tab-edit" class="hidden">
        <div class="row row--between mb-4">
          <span class="badge" id="save-state">Сохранено</span>
          <div class="row">
            <button class="btn btn--ghost btn--sm" id="revisions-btn" type="button">История правок</button>
            <button class="btn btn--secondary btn--sm" id="save-btn" type="button">Сохранить</button>
          </div>
        </div>
        <label class="sr-only" for="result-editor">Редактор результата</label>
        <textarea class="textarea textarea--reading" id="result-editor" rows="20" spellcheck="true"></textarea>
      </div>

      <div id="stats-panel" class="grid grid--3 mt-6"></div>
    </div>
  </div>
</section>`;
  return {
    title: 'Рабочий экран',
    body,
    scripts: ['/js/pages/editor.js'],
  };
}

// ---------- История ----------
function historyPage({ user }) {
  if (!user) return { redirect: '/login' };
  const body = `
<section class="section" style="padding-top:var(--s-6)">
  <div class="container">
    <div class="row row--between mb-6">
      <div>
        <h1 style="margin-bottom:var(--s-1)">История</h1>
        <p class="muted mb-0">Все твои тексты. Можно вернуться и поправить.</p>
      </div>
      <a class="btn btn--sm" href="/app">Вставить текст</a>
    </div>
    <label class="field" style="max-width:420px">
      <span class="sr-only">Поиск по истории</span>
      <input class="input" type="search" id="history-search" placeholder="Поиск по текстам" autocomplete="off">
    </label>
    <div id="history-list" class="history-list" aria-live="polite"></div>
    <div id="history-empty" class="empty hidden">
      ${illustration('empty', 'empty__art')}
      <h3>Пока пусто</h3>
      <p>Вставь текст и нажми «Обработать» — результат появится здесь.</p>
      <a class="btn" href="/app">Вставить текст</a>
    </div>
    <div class="row mt-6" id="history-more-row" hidden>
      <button class="btn btn--secondary" id="history-more" type="button">Показать ещё</button>
    </div>
  </div>
</section>`;
  return { title: 'История', body, scripts: ['/js/pages/history.js'] };
}

// ---------- Экран задачи ----------
function jobPage({ user, params }) {
  if (!user) return { redirect: '/login' };
  const body = `
<section class="section" style="padding-top:var(--s-6)">
  <div class="container" style="max-width:720px">
    <a class="btn btn--ghost btn--sm mb-6" href="/history">← В историю</a>
    <h1 id="job-title">Обрабатываем</h1>
    <p class="muted" id="job-subtitle">Это может занять пару минут.</p>
    <div class="card mt-6">
      <div class="row row--between mb-4">
        <strong id="job-stage">Готовимся…</strong>
        <span class="badge" id="job-pct">0%</span>
      </div>
      <div class="progress"><div class="progress__bar" id="job-bar"></div></div>
      <ul class="stage-list" id="job-stages">
        <li data-stage="queued"><span class="stage-dot"></span>В очереди</li>
        <li data-stage="extract"><span class="stage-dot"></span>Читаю файл</li>
        <li data-stage="ocr"><span class="stage-dot"></span>Распознаю скан</li>
        <li data-stage="precheck"><span class="stage-dot"></span>Проверяю текст</li>
        <li data-stage="rules"><span class="stage-dot"></span>Причёсываю формулировки</li>
        <li data-stage="llm"><span class="stage-dot"></span>Упрощаю язык</li>
        <li data-stage="done"><span class="stage-dot"></span>Готово</li>
      </ul>
      <div class="row mt-6">
        <button class="btn btn--secondary" id="job-cancel" type="button">Отменить</button>
        <a class="btn hidden" id="job-open" href="#">Открыть результат</a>
      </div>
    </div>
    <div class="banner banner--err mt-6 hidden" id="job-error" role="alert">
      ${icon('alert')}
      <div><div class="banner__title">Не получилось</div><p id="job-error-text"></p></div>
    </div>
  </div>
</section>`;
  return { title: 'Задача', body, scripts: ['/js/pages/job.js'] };
}

// ---------- Настройки ----------
function settingsPage({ user }) {
  if (!user) return { redirect: '/login' };
  const body = `
<section class="section" style="padding-top:var(--s-6)">
  <div class="container" style="max-width:760px">
    <h1>Настройки</h1>
    <div class="card mt-6">
      <h3 class="card__title">Профиль</h3>
      <p class="mb-0"><strong>Почта:</strong> ${esc(user.email)}</p>
      <p class="small muted mb-0">Аккаунт с ${new Date(user.createdAt).toLocaleDateString('ru-RU')}</p>
      <div class="row mt-4">
        <button class="btn btn--ghost btn--sm" type="button" data-logout>${icon('logout', 16)} Выйти из аккаунта</button>
      </div>
    </div>

    <div class="card mt-6">
      <h3 class="card__title">Согласие на обработку данных</h3>
      <p class="small muted">Версия политики: ${esc(config.policyVersion)}. Оператор: ${esc(config.operator.name)}.</p>
      <p id="consent-status" class="mb-4"></p>
      <div class="row">
        <button class="btn btn--danger" id="revoke-consent" type="button">Отозвать согласие</button>
        <a class="btn btn--ghost" href="/legal/privacy">Политика данных</a>
      </div>
      <p class="tiny muted mt-4 mb-0">Если отзовёшь согласие, мы удалим все твои тексты. Это не вернуть.</p>
    </div>

    <div class="card mt-6">
      <h3 class="card__title">Хранение</h3>
      <label class="field">
        <span class="field__label">Сколько дней хранить тексты</span>
        <input class="input" type="number" id="retention-days" min="1" max="365" value="${user.retentionDays ?? config.retentionDays}" style="max-width:160px">
      </label>
      <div class="row">
        <button class="btn btn--secondary btn--sm" id="save-retention" type="button">Сохранить срок</button>
        <button class="btn btn--ghost btn--sm" id="purge-now" type="button">Удалить старое сейчас</button>
      </div>
    </div>

    <div class="card mt-6">
      <h3 class="card__title">Служебное</h3>
      <dl class="small muted" style="display:grid;grid-template-columns:auto 1fr;gap:8px 16px;margin:0">
        <dt>Модель</dt><dd style="margin:0" id="info-llm">—</dd>
        <dt>OCR</dt><dd style="margin:0" id="info-ocr">—</dd>
        <dt>Лимит текста</dt><dd style="margin:0">${config.limits.maxChars.toLocaleString('ru-RU')} знаков</dd>
        <dt>Лимит PDF</dt><dd style="margin:0">${config.limits.maxPdfPages} страниц</dd>
      </dl>
      ${config.llm.enabled && config.llm.provider !== 'rules'
    ? '<p class="small muted mt-4 mb-0">Если включишь «Простым языком», текст для правки уйдёт провайдеру модели. Не вставляй туда личные данные.</p>'
    : ''}
      <div class="row mt-6">
        <button class="btn btn--ghost btn--sm" id="export-json" type="button">Скачать мои данные (JSON)</button>
      </div>
    </div>

    <div class="card mt-6" style="border-color:rgba(180,35,44,.3)">
      <h3 class="card__title" style="color:#B4232C">Удалить аккаунт</h3>
      <p class="small muted">Удалим аккаунт и все тексты. Восстановить нельзя.</p>
      <button class="btn btn--danger" id="delete-account" type="button">Удалить аккаунт</button>
    </div>
  </div>
</section>`;
  return { title: 'Настройки', body, scripts: ['/js/pages/settings.js'] };
}

// ---------- Правовые ----------
function legalPrivacy() {
  const body = `
<section class="section" style="padding-top:var(--s-6)">
  <div class="container">
    <h1>Политика обработки данных</h1>
    <p class="muted">Версия ${esc(config.policyVersion)}</p>
    <div class="prose mt-8">
      <p>Здесь простым языком: какие данные мы берём, зачем, сколько храним и как удалить.</p>

      <h2>Какие данные</h2>
      <ul>
        <li>Адрес почты и пароль (пароль хранится только в виде хеша — прочитать его нельзя).</li>
        <li>Тексты, которые ты загружаешь, и результаты их обработки.</li>
        <li>Факт согласия: время, версия политики, IP-адрес.</li>
      </ul>

      <h2>Зачем</h2>
      <ul>
        <li>Чтобы пускать тебя в аккаунт.</li>
        <li>Чтобы показывать историю твоих текстов и давать их править.</li>
        <li>Чтобы соблюсти закон о персональных данных (152-ФЗ) — нужен факт согласия.</li>
      </ul>

      <h2>Сколько храним</h2>
      <p>По умолчанию ${config.retentionDays} дней. Срок можно поменять в настройках или удалить всё раньше.</p>

      <h2>Кому передаём</h2>
      <p>Никому для рекламы и не продаём. Текст уходит модели только если она включена на сервере. По умолчанию работают только правила — текст не покидает сервер.</p>

      <h2>Твои права</h2>
      <ul>
        <li>Посмотреть, что мы храним (кнопка «Скачать мои данные»).</li>
        <li>Удалить отдельный текст.</li>
        <li>Отозвать согласие — тогда удалим все тексты.</li>
        <li>Удалить аккаунт целиком.</li>
      </ul>

      <h2>Связаться</h2>
      <p>Оператор: ${esc(config.operator.name)}. Почта: ${esc(config.operator.email)}.</p>
      <p>Форма обращения субъекта ПДн — <a href="/legal/personal-data">здесь</a>.</p>
    </div>
  </div>
</section>`;
  return { title: 'Политика данных', body };
}

function legalTerms() {
  const body = `
<section class="section" style="padding-top:var(--s-6)">
  <div class="container">
    <h1>Оферта</h1>
    <p class="muted">Версия ${esc(config.policyVersion)}</p>
    <div class="prose mt-8">
      <h2>Что мы делаем</h2>
      <p>Сервис меняет подачу текста, чтобы его было легче читать. Мы не сокращаем содержание и не пересказываем.</p>

      <h2>Что нельзя загружать</h2>
      <ul>
        <li>Незаконные материалы.</li>
        <li>Чужие авторские тексты целиком, если у тебя нет права их менять. Научные статьи — можно.</li>
        <li>Персональные данные других людей без их согласия.</li>
      </ul>

      <h2>Результат</h2>
      <p>Мы стараемся сохранить смысл, но текст после правок — это твой текст. Проверяй важное перед публикацией.</p>

      <h2>Ответственность</h2>
      <p>Сервис бесплатный и предоставляется «как есть». Мы не гарантируем бесперебойную работу, но стараемся.</p>

      <h2>Согласие</h2>
      <p>Для обработки текстов нужно согласие на обработку персональных данных. Его можно отозвать в настройках.</p>
    </div>
  </div>
</section>`;
  return { title: 'Оферта', body };
}

function legalPersonalData() {
  const body = `
<section class="section" style="padding-top:var(--s-6)">
  <div class="container" style="max-width:760px">
    <h1>Форма обращения субъекта ПДн</h1>
    <p class="muted">Напиши нам — ответим в срок по закону.</p>
    <form class="card mt-6" id="pd-form" novalidate>
      <label class="field">
        <span class="field__label">Кто ты</span>
        <input class="input" name="name" id="pd-name" autocomplete="name" required>
      </label>
      <label class="field">
        <span class="field__label">Почта для ответа</span>
        <input class="input" type="email" name="email" id="pd-email" autocomplete="email" required>
      </label>
      <label class="field">
        <span class="field__label">Что нужно</span>
        <select class="select" name="kind" id="pd-kind">
          <option value="access">Узнать, какие данные хранятся</option>
          <option value="delete">Удалить данные</option>
          <option value="revoke">Отозвать согласие</option>
          <option value="other">Другое</option>
        </select>
      </label>
      <label class="field">
        <span class="field__label">Комментарий</span>
        <textarea class="textarea" name="comment" id="pd-comment" rows="4"></textarea>
      </label>
      <button class="btn btn--lg btn--block" type="submit">Отправить</button>
      <p class="tiny muted text-center mt-4 mb-0">Пока форма не подключена к отправке писем: сохрани текст и пришли на ${esc(config.operator.email)}.</p>
    </form>
  </div>
</section>`;
  return { title: 'Форма субъекта ПДн', body, scripts: ['/js/pages/legal.js'] };
}

export function notFound() {
  return {
    title: 'Страница не найдена',
    body: `
<section class="section">
  <div class="container empty">
    ${illustration('error', 'empty__art')}
    <h1>Такой страницы нет</h1>
    <p>Возможно, ссылка устарела или в ней опечатка.</p>
    <a class="btn btn--lg" href="/">На главную</a>
  </div>
</section>`,
  };
}

export function serverError() {
  return {
    title: 'Что-то пошло не так',
    body: `
<section class="section">
  <div class="container empty">
    ${illustration('error', 'empty__art')}
    <h1>Что-то пошло не так</h1>
    <p>Попробуй обновить страницу. Если не помогает — вернись на главную и начни заново.</p>
    <a class="btn btn--lg" href="/">На главную</a>
  </div>
</section>`,
  };
}

export const PAGES = [
  { name: 'landing', path: '/', render: landing },
  { name: 'start', path: '/start', render: start },
  { name: 'login', path: '/login', render: login },
  { name: 'register', path: '/register', render: register },
  { name: 'app', path: '/app', render: appPage },
  { name: 'history', path: '/history', render: historyPage },
  { name: 'job', path: '/jobs/:id', render: jobPage },
  { name: 'settings', path: '/settings', render: settingsPage },
  { name: 'privacy', path: '/legal/privacy', render: legalPrivacy },
  { name: 'terms', path: '/legal/terms', render: legalTerms },
  { name: 'personal-data', path: '/legal/personal-data', render: legalPersonalData },
];
