'use strict';

const { STATUSES } = require('./constants');
const {
  ValidationError,
  NotFoundError,
  ConflictError,
} = require('./errors');

function validateRequiredString(name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`Поле ${name} обязательно`);
  }
  return value.trim();
}

class Store {
  constructor(db) {
    this.db = db;
  }

  getAllUsers() {
    return this.db
      .prepare('SELECT id, name, role FROM users ORDER BY role, name')
      .all();
  }

  getUsersByRole(role) {
    return this.db
      .prepare('SELECT id, name, role FROM users WHERE role = ? ORDER BY name')
      .all(role);
  }

  getUserById(userId) {
    return (
      this.db
        .prepare('SELECT id, name, role FROM users WHERE id = ?')
        .get(Number(userId)) || null
    );
  }

  getUserByCredentials(name, password) {
    return (
      this.db
        .prepare('SELECT id, name, role FROM users WHERE name = ? AND password = ?')
        .get(name, password) || null
    );
  }

  getRequestById(requestId) {
    const request = this.db
      .prepare(
        `SELECT r.id,
                r.clientName,
                r.phone,
                r.address,
                r.problemText,
                r.status,
                r.assignedTo,
                u.name AS assignedMasterName,
                r.createdAt,
                r.updatedAt
           FROM requests r
      LEFT JOIN users u ON u.id = r.assignedTo
          WHERE r.id = ?`
      )
      .get(Number(requestId));

    if (!request) {
      throw new NotFoundError('Заявка не найдена');
    }

    return request;
  }

  listRequests(statusFilter) {
    if (statusFilter && statusFilter !== 'all' && !STATUSES.includes(statusFilter)) {
      throw new ValidationError('Некорректный фильтр статуса');
    }

    if (!statusFilter || statusFilter === 'all') {
      return this.db
        .prepare(
          `SELECT r.id,
                  r.clientName,
                  r.phone,
                  r.address,
                  r.problemText,
                  r.status,
                  r.assignedTo,
                  u.name AS assignedMasterName,
                  r.createdAt,
                  r.updatedAt
             FROM requests r
        LEFT JOIN users u ON u.id = r.assignedTo
         ORDER BY r.id DESC`
        )
        .all();
    }

    return this.db
      .prepare(
        `SELECT r.id,
                r.clientName,
                r.phone,
                r.address,
                r.problemText,
                r.status,
                r.assignedTo,
                u.name AS assignedMasterName,
                r.createdAt,
                r.updatedAt
           FROM requests r
      LEFT JOIN users u ON u.id = r.assignedTo
          WHERE r.status = ?
       ORDER BY r.id DESC`
      )
      .all(statusFilter);
  }

  listRequestsForMaster(masterId) {
    return this.db
      .prepare(
        `SELECT r.id,
                r.clientName,
                r.phone,
                r.address,
                r.problemText,
                r.status,
                r.assignedTo,
                r.createdAt,
                r.updatedAt
           FROM requests r
          WHERE r.assignedTo = ?
       ORDER BY r.id DESC`
      )
      .all(Number(masterId));
  }

  createRequest(input, actorId = null) {
    const clientName = validateRequiredString('clientName', input.clientName);
    const phone = validateRequiredString('phone', input.phone);
    const address = validateRequiredString('address', input.address);
    const problemText = validateRequiredString('problemText', input.problemText);

    const result = this.db
      .prepare(
        `INSERT INTO requests (clientName, phone, address, problemText, status, assignedTo, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, 'new', NULL, datetime('now'), datetime('now'))`
      )
      .run(clientName, phone, address, problemText);

    const requestId = Number(result.lastInsertRowid);
    this.addEvent(requestId, actorId, 'created', null, 'new', 'Создана новая заявка');

    return this.getRequestById(requestId);
  }

  assignRequest(requestId, masterId, actorId) {
    const numericRequestId = Number(requestId);
    const numericMasterId = Number(masterId);

    if (!numericMasterId) {
      throw new ValidationError('Не указан мастер для назначения');
    }

    const master = this.db
      .prepare('SELECT id, role FROM users WHERE id = ?')
      .get(numericMasterId);

    if (!master || master.role !== 'master') {
      throw new ValidationError('Выбранный пользователь не является мастером');
    }

    const before = this.getRequestById(numericRequestId);

    const result = this.db
      .prepare(
        `UPDATE requests
            SET assignedTo = ?,
                status = 'assigned',
                updatedAt = datetime('now')
          WHERE id = ?
            AND status = 'new'`
      )
      .run(numericMasterId, numericRequestId);

    if (result.changes === 0) {
      throw new ConflictError('Назначить можно только заявку в статусе new');
    }

    this.addEvent(
      numericRequestId,
      actorId,
      'assigned',
      before.status,
      'assigned',
      `Заявка назначена мастеру #${numericMasterId}`
    );

    return this.getRequestById(numericRequestId);
  }

  cancelRequest(requestId, actorId) {
    const numericRequestId = Number(requestId);
    const before = this.getRequestById(numericRequestId);

    const result = this.db
      .prepare(
        `UPDATE requests
            SET status = 'canceled',
                updatedAt = datetime('now')
          WHERE id = ?
            AND status IN ('new', 'assigned', 'in_progress')`
      )
      .run(numericRequestId);

    if (result.changes === 0) {
      throw new ConflictError('Отменить можно только заявку в статусах new/assigned/in_progress');
    }

    this.addEvent(numericRequestId, actorId, 'canceled', before.status, 'canceled', 'Заявка отменена диспетчером');

    return this.getRequestById(numericRequestId);
  }

  takeRequest(requestId, masterId) {
    const numericRequestId = Number(requestId);
    const numericMasterId = Number(masterId);
    const before = this.getRequestById(numericRequestId);

    const result = this.db
      .prepare(
        `UPDATE requests
            SET status = 'in_progress',
                updatedAt = datetime('now')
          WHERE id = ?
            AND assignedTo = ?
            AND status = 'assigned'`
      )
      .run(numericRequestId, numericMasterId);

    if (result.changes === 0) {
      throw new ConflictError('Заявка уже взята в работу или недоступна текущему мастеру');
    }

    this.addEvent(numericRequestId, numericMasterId, 'taken_to_work', before.status, 'in_progress', 'Мастер взял заявку в работу');

    return this.getRequestById(numericRequestId);
  }

  completeRequest(requestId, masterId) {
    const numericRequestId = Number(requestId);
    const numericMasterId = Number(masterId);
    const before = this.getRequestById(numericRequestId);

    const result = this.db
      .prepare(
        `UPDATE requests
            SET status = 'done',
                updatedAt = datetime('now')
          WHERE id = ?
            AND assignedTo = ?
            AND status = 'in_progress'`
      )
      .run(numericRequestId, numericMasterId);

    if (result.changes === 0) {
      throw new ConflictError('Завершить можно только заявку в статусе in_progress');
    }

    this.addEvent(numericRequestId, numericMasterId, 'completed', before.status, 'done', 'Заявка завершена мастером');

    return this.getRequestById(numericRequestId);
  }

  listEvents(requestId) {
    return this.db
      .prepare(
        `SELECT e.id,
                e.requestId,
                e.actorId,
                u.name AS actorName,
                e.action,
                e.fromStatus,
                e.toStatus,
                e.details,
                e.createdAt
           FROM request_events e
      LEFT JOIN users u ON u.id = e.actorId
          WHERE e.requestId = ?
       ORDER BY e.id DESC`
      )
      .all(Number(requestId));
  }

  addEvent(requestId, actorId, action, fromStatus, toStatus, details = null) {
    this.db
      .prepare(
        `INSERT INTO request_events (requestId, actorId, action, fromStatus, toStatus, details, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(Number(requestId), actorId ? Number(actorId) : null, action, fromStatus, toStatus, details);
  }
}

module.exports = {
  Store,
};
