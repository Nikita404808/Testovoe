INSERT OR IGNORE INTO users (id, name, password, role)
VALUES
  (1, 'dispatcher', 'dispatcher123', 'dispatcher'),
  (2, 'master_ivan', 'master123', 'master'),
  (3, 'master_petr', 'master123', 'master');

INSERT OR IGNORE INTO requests (id, clientName, phone, address, problemText, status, assignedTo, createdAt, updatedAt)
VALUES
  (1, 'Анна Ильина', '+7 900 100-10-10', 'Москва, ул. Ленина, 10', 'Не включается стиральная машина', 'new', NULL, datetime('now', '-2 day'), datetime('now', '-2 day')),
  (2, 'Игорь Павлов', '+7 900 200-20-20', 'Москва, ул. Пушкина, 5', 'Течёт кран на кухне', 'assigned', 2, datetime('now', '-1 day'), datetime('now', '-1 day')),
  (3, 'Мария Орлова', '+7 900 300-30-30', 'Москва, пр-т Мира, 45', 'Проблемы с электрикой в коридоре', 'in_progress', 3, datetime('now', '-4 hour'), datetime('now', '-1 hour'));

INSERT OR IGNORE INTO request_events (id, requestId, actorId, action, fromStatus, toStatus, details, createdAt)
VALUES
  (1, 1, NULL, 'created', NULL, 'new', 'Заявка создана', datetime('now', '-2 day')),
  (2, 2, NULL, 'created', NULL, 'new', 'Заявка создана', datetime('now', '-1 day')),
  (3, 2, 1, 'assigned', 'new', 'assigned', 'Заявка назначена мастеру #2', datetime('now', '-1 day')),
  (4, 3, NULL, 'created', NULL, 'new', 'Заявка создана', datetime('now', '-4 hour')),
  (5, 3, 1, 'assigned', 'new', 'assigned', 'Заявка назначена мастеру #3', datetime('now', '-3 hour')),
  (6, 3, 3, 'taken_to_work', 'assigned', 'in_progress', 'Мастер взял заявку в работу', datetime('now', '-2 hour'));
