'use strict';

const path = require('node:path');
const { openDatabase, runMigrations, DEFAULT_DB_PATH } = require('../src/db');

const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
const db = openDatabase(path.resolve(dbPath));
runMigrations(db);
db.close();

console.log(`Migrations applied for ${path.resolve(dbPath)}`);
