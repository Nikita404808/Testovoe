'use strict';

const STATUSES = Object.freeze(['new', 'assigned', 'in_progress', 'done', 'canceled']);
const ROLES = Object.freeze(['dispatcher', 'master']);

module.exports = {
  STATUSES,
  ROLES,
};
