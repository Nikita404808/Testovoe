'use strict';

const { STATUSES } = require('./constants');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function statusLabel(status) {
  const map = {
    new: 'new',
    assigned: 'assigned',
    in_progress: 'in_progress',
    done: 'done',
    canceled: 'canceled',
  };
  return map[status] || status;
}

function formatDate(dateValue) {
  const date = new Date(`${dateValue}Z`);
  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }
  return date.toLocaleString('ru-RU');
}

function renderLayout({ title, user, body, notice, error }) {
  const userBlock = user
    ? `<div class="user-badge">${escapeHtml(user.name)} (${escapeHtml(user.role)})
          <form method="post" action="/logout" class="inline-form">
            <button type="submit" class="button-link">Выйти</button>
          </form>
       </div>`
    : '<a href="/login">Вход</a>';

  const notifications = [
    notice ? `<div class="notice success">${escapeHtml(notice)}</div>` : '',
    error ? `<div class="notice error">${escapeHtml(error)}</div>` : '',
  ].join('');

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <header class="header">
    <h1>Ремонтная служба</h1>
    <nav>
      <a href="/requests/new">Создать заявку</a>
      <a href="/dispatcher">Панель диспетчера</a>
      <a href="/master">Панель мастера</a>
      ${userBlock}
    </nav>
  </header>
  <main class="container">
    ${notifications}
    ${body}
  </main>
</body>
</html>`;
}

function renderHomePage({ user }) {
  const body = `
<section class="card">
  <h2>Добро пожаловать</h2>
  <p>Это учебное приложение для обработки заявок в ремонтную службу.</p>
  <ul>
    <li><a href="/requests/new">Создать новую заявку</a></li>
    <li><a href="/dispatcher">Открыть панель диспетчера</a></li>
    <li><a href="/master">Открыть панель мастера</a></li>
  </ul>
</section>`;

  return renderLayout({ title: 'Главная', user, body });
}

function renderLoginPage({ user, users, error, notice }) {
  const userOptions = users
    .map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)} (${escapeHtml(item.role)})</option>`)
    .join('');

  const body = `
<section class="card narrow">
  <h2>Авторизация</h2>
  <p>Для теста используйте сиды из README.</p>
  <form method="post" action="/login" class="form-grid">
    <label>Пользователь
      <select name="name" required>
        <option value="">Выберите пользователя</option>
        ${userOptions}
      </select>
    </label>
    <label>Пароль
      <input type="password" name="password" required />
    </label>
    <button type="submit">Войти</button>
  </form>
</section>`;

  return renderLayout({ title: 'Вход', user, body, notice, error });
}

function renderCreateRequestPage({ user, error, notice, values = {} }) {
  const body = `
<section class="card narrow">
  <h2>Создание заявки</h2>
  <form method="post" action="/requests/new" class="form-grid">
    <label>Имя клиента
      <input name="clientName" required value="${escapeHtml(values.clientName)}" />
    </label>
    <label>Телефон
      <input id="phoneInput" name="phone" type="tel" inputmode="numeric" placeholder="+7 (___) ___-__-__" required value="${escapeHtml(values.phone)}" />
    </label>
    <label>Адрес
      <input name="address" required value="${escapeHtml(values.address)}" />
    </label>
    <label>Описание проблемы
      <textarea name="problemText" rows="4" required>${escapeHtml(values.problemText)}</textarea>
    </label>
    <button type="submit">Создать</button>
  </form>
  <script>
    (function () {
      const input = document.getElementById('phoneInput');
      if (!input) {
        return;
      }

      function formatPhone(value) {
        const digitsOnly = String(value || '').replace(/\\D/g, '');
        let digits = digitsOnly;

        if (digits.startsWith('7') || digits.startsWith('8')) {
          digits = digits.slice(1);
        }

        digits = digits.slice(0, 10);
        if (!digits.length) {
          return '';
        }

        let result = '+7 (';
        result += digits.slice(0, 3);

        if (digits.length >= 3) {
          result += ')';
        }

        if (digits.length > 3) {
          result += ' ' + digits.slice(3, 6);
        }

        if (digits.length > 6) {
          result += '-' + digits.slice(6, 8);
        }

        if (digits.length > 8) {
          result += '-' + digits.slice(8, 10);
        }

        return result;
      }

      function onInput() {
        input.value = formatPhone(input.value);
      }

      input.addEventListener('input', onInput);
      onInput();
    })();
  </script>
</section>`;

  return renderLayout({ title: 'Создание заявки', user, body, notice, error });
}

function renderDispatcherPage({ user, requests, masters, statusFilter, error, notice }) {
  const options = ['all', ...STATUSES]
    .map((status) => {
      const selected = status === statusFilter ? 'selected' : '';
      return `<option value="${status}" ${selected}>${status}</option>`;
    })
    .join('');

  const masterOptions = masters
    .map((master) => `<option value="${master.id}">${escapeHtml(master.name)}</option>`)
    .join('');

  const rows = requests
    .map((request) => {
      const assignForm =
        request.status === 'new'
          ? `<form method="post" action="/dispatcher/requests/${request.id}/assign" class="inline-form">
               <select name="masterId" required>
                 <option value="">Мастер</option>
                 ${masterOptions}
               </select>
               <button type="submit">Назначить</button>
             </form>`
          : '';

      const cancelForm = ['new', 'assigned', 'in_progress'].includes(request.status)
        ? `<form method="post" action="/dispatcher/requests/${request.id}/cancel" class="inline-form">
             <button type="submit" class="danger">Отменить</button>
           </form>`
        : '';

      return `<tr>
        <td>#${request.id}</td>
        <td>${escapeHtml(request.clientName)}</td>
        <td>${escapeHtml(request.phone)}</td>
        <td>${escapeHtml(request.address)}</td>
        <td>${escapeHtml(request.problemText)}</td>
        <td><span class="status status-${escapeHtml(request.status)}">${statusLabel(request.status)}</span></td>
        <td>${escapeHtml(request.assignedMasterName || '—')}</td>
        <td>${escapeHtml(formatDate(request.createdAt))}</td>
        <td>${assignForm}${cancelForm}</td>
      </tr>`;
    })
    .join('');

  const body = `
<section class="card">
  <h2>Панель диспетчера</h2>
  <form method="get" action="/dispatcher" class="inline-form filter-form">
    <label>Фильтр по статусу
      <select name="status">${options}</select>
    </label>
    <button type="submit">Применить</button>
  </form>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Клиент</th>
          <th>Телефон</th>
          <th>Адрес</th>
          <th>Проблема</th>
          <th>Статус</th>
          <th>Мастер</th>
          <th>Создана</th>
          <th>Действия</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="9">Заявок нет</td></tr>'}
      </tbody>
    </table>
  </div>
</section>`;

  return renderLayout({ title: 'Панель диспетчера', user, body, notice, error });
}

function renderMasterPage({ user, requests, error, notice }) {
  const rows = requests
    .map((request) => {
      const takeForm =
        request.status === 'assigned'
          ? `<form method="post" action="/master/requests/${request.id}/take" class="inline-form">
               <button type="submit">Взять в работу</button>
             </form>`
          : '';

      const completeForm =
        request.status === 'in_progress'
          ? `<form method="post" action="/master/requests/${request.id}/done" class="inline-form">
               <button type="submit">Завершить</button>
             </form>`
          : '';

      return `<tr>
        <td>#${request.id}</td>
        <td>${escapeHtml(request.clientName)}</td>
        <td>${escapeHtml(request.phone)}</td>
        <td>${escapeHtml(request.address)}</td>
        <td>${escapeHtml(request.problemText)}</td>
        <td><span class="status status-${escapeHtml(request.status)}">${statusLabel(request.status)}</span></td>
        <td>${escapeHtml(formatDate(request.updatedAt))}</td>
        <td>${takeForm}${completeForm}</td>
      </tr>`;
    })
    .join('');

  const body = `
<section class="card">
  <h2>Панель мастера</h2>
  <p>Показаны заявки, назначенные текущему мастеру.</p>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Клиент</th>
          <th>Телефон</th>
          <th>Адрес</th>
          <th>Проблема</th>
          <th>Статус</th>
          <th>Обновлена</th>
          <th>Действия</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="8">Заявок нет</td></tr>'}
      </tbody>
    </table>
  </div>
</section>`;

  return renderLayout({ title: 'Панель мастера', user, body, notice, error });
}

module.exports = {
  escapeHtml,
  renderHomePage,
  renderLoginPage,
  renderCreateRequestPage,
  renderDispatcherPage,
  renderMasterPage,
};
