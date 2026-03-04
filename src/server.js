'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const { DEFAULT_DB_PATH, openDatabase, runMigrations, runSeeds } = require('./db');
const { Store } = require('./store');
const { SessionStore } = require('./session');
const {
  parseCookies,
  sendJson,
  sendHtml,
  redirect,
  readBody,
  parseBody,
  setSessionCookie,
  clearSessionCookie,
  addQuery,
} = require('./http');
const {
  AppError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
} = require('./errors');
const {
  renderHomePage,
  renderLoginPage,
  renderCreateRequestPage,
  renderDispatcherPage,
  renderMasterPage,
} = require('./views');

function requireUser(user) {
  if (!user) {
    throw new UnauthorizedError('Нужно войти в систему');
  }
  return user;
}

function requireRole(user, role) {
  requireUser(user);
  if (user.role !== role) {
    throw new ForbiddenError('У вас нет доступа к этому разделу');
  }
  return user;
}

function parseRequestIdFromPath(pathname, pattern) {
  const match = pathname.match(pattern);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function getNoticeAndError(url) {
  return {
    notice: url.searchParams.get('notice') || '',
    error: url.searchParams.get('error') || '',
  };
}

function parseMasterId(body) {
  const raw = body.masterId;
  const masterId = Number(raw);
  if (!masterId) {
    throw new ValidationError('masterId обязателен');
  }
  return masterId;
}

function createServer(options = {}) {
  const dbPath = options.dbPath || process.env.DB_PATH || DEFAULT_DB_PATH;
  const seedOnStart = options.seed ?? process.env.SEED_ON_START !== 'false';

  const db = openDatabase(dbPath);
  runMigrations(db);
  if (seedOnStart) {
    runSeeds(db);
  }

  const store = new Store(db);
  const sessions = new SessionStore();

  const cssPath = path.join(process.cwd(), 'public', 'styles.css');
  const cssContent = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';

  const server = http.createServer(async (req, res) => {
    const method = req.method || 'GET';
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const isApi = pathname.startsWith('/api/');

    const cookies = parseCookies(req.headers.cookie || '');
    const currentSession = sessions.get(cookies.sid);
    const currentUser = currentSession ? store.getUserById(currentSession.userId) : null;

    try {
      if (method === 'GET' && pathname === '/styles.css') {
        res.writeHead(200, {
          'Content-Type': 'text/css; charset=utf-8',
          'Content-Length': Buffer.byteLength(cssContent),
        });
        res.end(cssContent);
        return;
      }

      if (method === 'GET' && pathname === '/healthz') {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === 'GET' && pathname === '/') {
        sendHtml(res, 200, renderHomePage({ user: currentUser }));
        return;
      }

      if (method === 'GET' && pathname === '/login') {
        const { notice, error } = getNoticeAndError(url);
        sendHtml(
          res,
          200,
          renderLoginPage({
            user: currentUser,
            users: store.getAllUsers(),
            error,
            notice,
          })
        );
        return;
      }

      if (method === 'POST' && pathname === '/login') {
        const rawBody = await readBody(req);
        const body = parseBody(rawBody, req.headers['content-type'] || 'application/x-www-form-urlencoded');
        const name = String(body.name || '').trim();
        const password = String(body.password || '');

        if (!name || !password) {
          redirect(res, addQuery('/login', { error: 'Введите пользователя и пароль' }));
          return;
        }

        const user = store.getUserByCredentials(name, password);
        if (!user) {
          redirect(res, addQuery('/login', { error: 'Неверные учетные данные' }));
          return;
        }

        const sessionId = sessions.create(user.id);
        setSessionCookie(res, sessionId);
        const nextPath = user.role === 'dispatcher' ? '/dispatcher' : '/master';
        redirect(res, addQuery(nextPath, { notice: 'Вы успешно вошли' }));
        return;
      }

      if (method === 'POST' && pathname === '/logout') {
        if (cookies.sid) {
          sessions.destroy(cookies.sid);
        }
        clearSessionCookie(res);
        redirect(res, addQuery('/login', { notice: 'Вы вышли из системы' }));
        return;
      }

      if (method === 'GET' && pathname === '/requests/new') {
        const { notice, error } = getNoticeAndError(url);
        sendHtml(res, 200, renderCreateRequestPage({ user: currentUser, notice, error }));
        return;
      }

      if (method === 'POST' && pathname === '/requests/new') {
        const rawBody = await readBody(req);
        const body = parseBody(rawBody, req.headers['content-type'] || 'application/x-www-form-urlencoded');

        try {
          const created = store.createRequest(body, currentUser ? currentUser.id : null);
          redirect(res, addQuery('/requests/new', { notice: `Заявка #${created.id} создана` }));
        } catch (error) {
          if (error instanceof AppError) {
            sendHtml(
              res,
              error.statusCode,
              renderCreateRequestPage({
                user: currentUser,
                error: error.message,
                values: body,
              })
            );
            return;
          }
          throw error;
        }
        return;
      }

      if (method === 'GET' && pathname === '/dispatcher') {
        try {
          requireRole(currentUser, 'dispatcher');
        } catch (error) {
          redirect(res, addQuery('/login', { error: 'Требуется вход как диспетчер' }));
          return;
        }

        const status = url.searchParams.get('status') || 'all';
        const { notice, error } = getNoticeAndError(url);

        sendHtml(
          res,
          200,
          renderDispatcherPage({
            user: currentUser,
            requests: store.listRequests(status),
            masters: store.getUsersByRole('master'),
            statusFilter: status,
            notice,
            error,
          })
        );
        return;
      }

      const assignUiId = parseRequestIdFromPath(pathname, /^\/dispatcher\/requests\/(\d+)\/assign$/);
      if (method === 'POST' && assignUiId !== null) {
        try {
          requireRole(currentUser, 'dispatcher');
          const rawBody = await readBody(req);
          const body = parseBody(rawBody, req.headers['content-type'] || 'application/x-www-form-urlencoded');
          const masterId = parseMasterId(body);
          store.assignRequest(assignUiId, masterId, currentUser.id);
          redirect(res, addQuery('/dispatcher', { notice: `Заявка #${assignUiId} назначена мастеру` }));
        } catch (error) {
          const message = error instanceof AppError ? error.message : 'Не удалось назначить мастера';
          redirect(res, addQuery('/dispatcher', { error: message }));
        }
        return;
      }

      const cancelUiId = parseRequestIdFromPath(pathname, /^\/dispatcher\/requests\/(\d+)\/cancel$/);
      if (method === 'POST' && cancelUiId !== null) {
        try {
          requireRole(currentUser, 'dispatcher');
          store.cancelRequest(cancelUiId, currentUser.id);
          redirect(res, addQuery('/dispatcher', { notice: `Заявка #${cancelUiId} отменена` }));
        } catch (error) {
          const message = error instanceof AppError ? error.message : 'Не удалось отменить заявку';
          redirect(res, addQuery('/dispatcher', { error: message }));
        }
        return;
      }

      if (method === 'GET' && pathname === '/master') {
        try {
          requireRole(currentUser, 'master');
        } catch {
          redirect(res, addQuery('/login', { error: 'Требуется вход как мастер' }));
          return;
        }

        const { notice, error } = getNoticeAndError(url);
        sendHtml(
          res,
          200,
          renderMasterPage({
            user: currentUser,
            requests: store.listRequestsForMaster(currentUser.id),
            notice,
            error,
          })
        );
        return;
      }

      const takeUiId = parseRequestIdFromPath(pathname, /^\/master\/requests\/(\d+)\/take$/);
      if (method === 'POST' && takeUiId !== null) {
        try {
          requireRole(currentUser, 'master');
          store.takeRequest(takeUiId, currentUser.id);
          redirect(res, addQuery('/master', { notice: `Заявка #${takeUiId} взята в работу` }));
        } catch (error) {
          const message = error instanceof AppError ? error.message : 'Не удалось взять заявку';
          redirect(res, addQuery('/master', { error: message }));
        }
        return;
      }

      const doneUiId = parseRequestIdFromPath(pathname, /^\/master\/requests\/(\d+)\/done$/);
      if (method === 'POST' && doneUiId !== null) {
        try {
          requireRole(currentUser, 'master');
          store.completeRequest(doneUiId, currentUser.id);
          redirect(res, addQuery('/master', { notice: `Заявка #${doneUiId} завершена` }));
        } catch (error) {
          const message = error instanceof AppError ? error.message : 'Не удалось завершить заявку';
          redirect(res, addQuery('/master', { error: message }));
        }
        return;
      }

      if (method === 'POST' && pathname === '/api/login') {
        const rawBody = await readBody(req);
        const body = parseBody(rawBody, req.headers['content-type'] || 'application/json');
        const name = String(body.name || '').trim();
        const password = String(body.password || '');

        if (!name || !password) {
          throw new ValidationError('Поля name и password обязательны');
        }

        const user = store.getUserByCredentials(name, password);
        if (!user) {
          throw new UnauthorizedError('Неверные учетные данные');
        }

        const sessionId = sessions.create(user.id);
        sendJson(
          res,
          200,
          { user },
          {
            'Set-Cookie': `sid=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax`,
          }
        );
        return;
      }

      if (method === 'POST' && pathname === '/api/logout') {
        if (cookies.sid) {
          sessions.destroy(cookies.sid);
        }
        sendJson(
          res,
          200,
          { ok: true },
          {
            'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax',
          }
        );
        return;
      }

      if (method === 'POST' && pathname === '/api/requests') {
        const rawBody = await readBody(req);
        const body = parseBody(rawBody, req.headers['content-type'] || 'application/json');
        const created = store.createRequest(body, currentUser ? currentUser.id : null);
        sendJson(res, 201, { request: created });
        return;
      }

      const requestApiId = parseRequestIdFromPath(pathname, /^\/api\/requests\/(\d+)$/);
      if (method === 'GET' && requestApiId !== null) {
        sendJson(res, 200, { request: store.getRequestById(requestApiId) });
        return;
      }

      if (method === 'GET' && pathname === '/api/dispatcher/requests') {
        requireRole(currentUser, 'dispatcher');
        const status = url.searchParams.get('status') || 'all';
        sendJson(res, 200, { requests: store.listRequests(status) });
        return;
      }

      const assignApiId = parseRequestIdFromPath(pathname, /^\/api\/dispatcher\/requests\/(\d+)\/assign$/);
      if (method === 'POST' && assignApiId !== null) {
        const user = requireRole(currentUser, 'dispatcher');
        const rawBody = await readBody(req);
        const body = parseBody(rawBody, req.headers['content-type'] || 'application/json');
        const assigned = store.assignRequest(assignApiId, parseMasterId(body), user.id);
        sendJson(res, 200, { request: assigned });
        return;
      }

      const cancelApiId = parseRequestIdFromPath(pathname, /^\/api\/dispatcher\/requests\/(\d+)\/cancel$/);
      if (method === 'POST' && cancelApiId !== null) {
        const user = requireRole(currentUser, 'dispatcher');
        const canceled = store.cancelRequest(cancelApiId, user.id);
        sendJson(res, 200, { request: canceled });
        return;
      }

      if (method === 'GET' && pathname === '/api/master/requests') {
        const user = requireRole(currentUser, 'master');
        sendJson(res, 200, { requests: store.listRequestsForMaster(user.id) });
        return;
      }

      const takeApiId = parseRequestIdFromPath(pathname, /^\/api\/master\/requests\/(\d+)\/take$/);
      if (method === 'POST' && takeApiId !== null) {
        const user = requireRole(currentUser, 'master');
        const updated = store.takeRequest(takeApiId, user.id);
        sendJson(res, 200, { request: updated });
        return;
      }

      const doneApiId = parseRequestIdFromPath(pathname, /^\/api\/master\/requests\/(\d+)\/done$/);
      if (method === 'POST' && doneApiId !== null) {
        const user = requireRole(currentUser, 'master');
        const updated = store.completeRequest(doneApiId, user.id);
        sendJson(res, 200, { request: updated });
        return;
      }

      if (isApi) {
        throw new AppError(404, 'API endpoint не найден');
      }

      sendHtml(res, 404, '<h1>404</h1><p>Страница не найдена</p>');
    } catch (error) {
      const statusCode = error instanceof AppError ? error.statusCode : 500;
      const message = error instanceof AppError ? error.message : 'Внутренняя ошибка сервера';

      if (isApi) {
        sendJson(res, statusCode, { error: message });
        return;
      }

      sendHtml(
        res,
        statusCode,
        renderHomePage({ user: currentUser })
          .replace('</main>', `<div class="notice error">${message}</div></main>`)
      );

      if (!(error instanceof AppError)) {
        console.error(error);
      }
    }
  });

  return {
    db,
    store,
    server,
    port: null,
    async start(port = Number(process.env.PORT) || 3000, host = process.env.HOST || '127.0.0.1') {
      await new Promise((resolve) => {
        server.listen(port, host, resolve);
      });
      this.port = server.address().port;
      this.host = host;
      return this.port;
    },
    async stop() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      db.close();
    },
  };
}

if (require.main === module) {
  const app = createServer();
  app.start().then((port) => {
    console.log(`Server started on http://${app.host}:${port}`);
  });
}

module.exports = {
  createServer,
};
