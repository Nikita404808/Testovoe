'use strict';

const path = require('node:path');
const { openDatabase, runMigrations, runSeeds, DEFAULT_DB_PATH } = require('../src/db');

const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
const db = openDatabase(path.resolve(dbPath));
runMigrations(db);
runSeeds(db);
db.close();

console.log(`Database initialized for ${path.resolve(dbPath)}`);
