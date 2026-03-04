'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createServer } = require('../src/server');

async function startTestApp(t) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-service-test-'));
  const dbPath = path.join(tempDir, 'app.db');
  const app = createServer({ dbPath, seed: true });
  await app.start(0);

  t.after(async () => {
    await app.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  return app;
}

function buildUrl(app, pathname) {
  return `http://127.0.0.1:${app.port}${pathname}`;
}

async function apiRequest(app, pathname, options = {}) {
  const method = options.method || 'GET';
  const headers = {};

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.cookie) {
    headers.Cookie = options.cookie;
  }

  const response = await fetch(buildUrl(app, pathname), {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let parsedBody = text;
  try {
    parsedBody = JSON.parse(text);
  } catch {
    // keep string body
  }

  return {
    status: response.status,
    body: parsedBody,
    setCookie: response.headers.get('set-cookie'),
  };
}

async function loginAndGetCookie(app, name, password) {
  const response = await apiRequest(app, '/api/login', {
    method: 'POST',
    body: { name, password },
  });

  assert.equal(response.status, 200);
  assert.ok(response.setCookie);
  return response.setCookie.split(';')[0];
}

test('POST /api/requests создает заявку со статусом new', async (t) => {
  const app = await startTestApp(t);

  const createResponse = await apiRequest(app, '/api/requests', {
    method: 'POST',
    body: {
      clientName: 'Тестовый клиент',
      phone: '+7 900 777-77-77',
      address: 'Тестовый адрес, 10',
      problemText: 'Не работает холодильник',
    },
  });

  assert.equal(createResponse.status, 201);
  assert.equal(createResponse.body.request.status, 'new');
  assert.ok(createResponse.body.request.id > 0);

  const requestId = createResponse.body.request.id;
  const getResponse = await apiRequest(app, `/api/requests/${requestId}`);

  assert.equal(getResponse.status, 200);
  assert.equal(getResponse.body.request.clientName, 'Тестовый клиент');
  assert.equal(getResponse.body.request.status, 'new');
});

test('Параллельный take возвращает 200 и 409 (race-safe)', async (t) => {
  const app = await startTestApp(t);

  const dispatcherCookie = await loginAndGetCookie(app, 'dispatcher', 'dispatcher123');
  const masterCookieA = await loginAndGetCookie(app, 'master_ivan', 'master123');
  const masterCookieB = await loginAndGetCookie(app, 'master_ivan', 'master123');

  const createResponse = await apiRequest(app, '/api/requests', {
    method: 'POST',
    body: {
      clientName: 'Race клиент',
      phone: '+7 900 101-01-01',
      address: 'Параллельная улица, 2',
      problemText: 'Проверка take',
    },
  });

  const requestId = createResponse.body.request.id;

  const assignResponse = await apiRequest(app, `/api/dispatcher/requests/${requestId}/assign`, {
    method: 'POST',
    cookie: dispatcherCookie,
    body: { masterId: 2 },
  });

  assert.equal(assignResponse.status, 200);
  assert.equal(assignResponse.body.request.status, 'assigned');

  const [takeA, takeB] = await Promise.all([
    apiRequest(app, `/api/master/requests/${requestId}/take`, {
      method: 'POST',
      cookie: masterCookieA,
    }),
    apiRequest(app, `/api/master/requests/${requestId}/take`, {
      method: 'POST',
      cookie: masterCookieB,
    }),
  ]);

  const sortedStatuses = [takeA.status, takeB.status].sort((a, b) => a - b);
  assert.deepEqual(sortedStatuses, [200, 409]);

  const finalState = await apiRequest(app, `/api/requests/${requestId}`);
  assert.equal(finalState.status, 200);
  assert.equal(finalState.body.request.status, 'in_progress');
});
