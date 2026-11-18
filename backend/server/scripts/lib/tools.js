// Shared helpers for the command-line installation tools.
import { readFileSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import mysql from 'mysql2/promise';

export const databaseDir = new URL('../../../database/', import.meta.url);

/** Opens a single connection that may run multi-statement SQL files. Only use with trusted files from this repository. */
export async function adminConnection(databaseConfig) {
  return mysql.createConnection({
    uri: databaseConfig.connectionString,
    ssl: databaseConfig.ssl || undefined,
    multipleStatements: true,
    timezone: 'Z',
    connectTimeout: 10000,
  });
}

/** Applies schema.sql and every migration in order. All statements are idempotent (IF NOT EXISTS). */
export async function applySchema(connection, { seed = false, log = console.info } = {}) {
  await connection.query(readFileSync(new URL('schema.sql', databaseDir), 'utf8'));
  log('Applied schema.sql');
  const migrations = new URL('migrations/', databaseDir);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
    await connection.query(readFileSync(new URL(file, migrations), 'utf8'));
    log(`Applied migrations/${file}`);
  }
  if (seed) {
    const [[{ total }]] = await connection.query('SELECT COUNT(*) AS total FROM `user`');
    if (Number(total) > 0) {
      log('Skipped seed.sql: the user table already has accounts.');
    } else {
      await connection.query(readFileSync(new URL('seed.sql', databaseDir), 'utf8'));
      log('Loaded seed.sql demo data (all demo passwords: Password123!)');
    }
  }
}

export function prompter() {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  // Queue lines ourselves so answers piped in ahead of time (scripted installs) are not lost.
  const lines = [], waiting = [];
  let closed = false, muted = false;
  rl.on('line', (text) => (waiting.length ? waiting.shift()(text) : lines.push(text)));
  rl.on('close', () => { closed = true; while (waiting.length) waiting.shift()(null); });
  const write = rl._writeToOutput?.bind(rl);
  if (write) rl._writeToOutput = (text) => { if (!muted || text.includes('\n')) write(text); };
  const next = async (question) => {
    process.stdout.write(question);
    const text = lines.length ? lines.shift() : closed ? null : await new Promise((resolve) => waiting.push(resolve));
    if (text === null) throw new Error('Input ended before setup finished.');
    if (!process.stdin.isTTY) process.stdout.write('\n');
    return text;
  };
  const ask = async (question, fallback = '') => (await next(`${question}${fallback ? ` [${fallback}]` : ''}: `)).trim() || fallback;
  const confirm = async (question, fallback = true) => {
    const answer = (await ask(`${question} (${fallback ? 'Y/n' : 'y/N'})`)).toLowerCase();
    return answer ? answer.startsWith('y') : fallback;
  };
  /** Reads a secret without echoing it to the terminal. */
  const secret = async (question) => {
    muted = Boolean(process.stdin.isTTY);
    try { return await next(`${question}: `); } finally { muted = false; }
  };
  return { ask, confirm, secret, close: () => rl.close() };
}

export function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
