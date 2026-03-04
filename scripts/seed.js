'use strict';

const path = require('node:path');
const { openDatabase, runSeeds, DEFAULT_DB_PATH } = require('../src/db');

const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
const db = openDatabase(path.resolve(dbPath));
runSeeds(db);
db.close();

console.log(`Seeds applied for ${path.resolve(dbPath)}`);
