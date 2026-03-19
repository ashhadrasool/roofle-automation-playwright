import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'roofle.db');

// Ensure data directory exists
import fs from 'fs';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS job_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT,
    firstName TEXT,
    lastName TEXT,
    phone TEXT,
    email TEXT,
    error TEXT,
    step TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS job_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT,
    firstName TEXT,
    lastName TEXT,
    phone TEXT,
    email TEXT,
    leadUrl TEXT,
    quoteData TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

const insertError = db.prepare(`
  INSERT INTO job_errors (address, firstName, lastName, phone, email, error, step)
  VALUES (@address, @firstName, @lastName, @phone, @email, @error, @step)
`);

const insertResult = db.prepare(`
  INSERT INTO job_results (address, firstName, lastName, phone, email, leadUrl, quoteData)
  VALUES (@address, @firstName, @lastName, @phone, @email, @leadUrl, @quoteData)
`);

export function logError(input: { address: string; firstName: string; lastName: string; phone: string; email: string }, error: string, step: string) {
  insertError.run({ ...input, error, step });
}

export function logResult(input: { address: string; firstName: string; lastName: string; phone: string; email: string }, leadUrl: string, quoteData: any) {
  insertResult.run({ ...input, leadUrl, quoteData: JSON.stringify(quoteData) });
}

export function getErrors(limit = 50) {
  return db.prepare('SELECT * FROM job_errors ORDER BY id DESC LIMIT ?').all(limit);
}

export function getResults(limit = 50) {
  return db.prepare('SELECT * FROM job_results ORDER BY id DESC LIMIT ?').all(limit);
}

export default db;
