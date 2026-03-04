'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'app.db');

function ensureDbDirectory(dbPath) {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
}

function openDatabase(dbPath = DEFAULT_DB_PATH) {
  ensureDbDirectory(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

function runSqlFile(db, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  db.exec(sql);
}

function runSqlDirectory(db, dirPath) {
  const files = fs
    .readdirSync(dirPath)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    runSqlFile(db, path.join(dirPath, file));
  }
}

function runMigrations(db, migrationsDir = path.join(process.cwd(), 'migrations')) {
  runSqlDirectory(db, migrationsDir);
}

function runSeeds(db, seedsDir = path.join(process.cwd(), 'seeds')) {
  runSqlDirectory(db, seedsDir);
}

module.exports = {
  DEFAULT_DB_PATH,
  openDatabase,
  runMigrations,
  runSeeds,
};
