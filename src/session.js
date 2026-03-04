'use strict';

const crypto = require('node:crypto');

class SessionStore {
  constructor() {
    this.sessions = new Map();
  }

  create(userId) {
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, {
      userId,
      createdAt: Date.now(),
    });
    return sessionId;
  }

  get(sessionId) {
    if (!sessionId) {
      return null;
    }
    return this.sessions.get(sessionId) || null;
  }

  destroy(sessionId) {
    if (!sessionId) {
      return;
    }
    this.sessions.delete(sessionId);
  }
}

module.exports = {
  SessionStore,
};
