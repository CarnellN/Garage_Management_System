// Installs or upgrades the database tables. Safe to re-run.
//   npm run db:init            schema + migrations
//   npm run db:init -- --seed  also loads demo data into an empty database
import { loadConfig } from '../src/config.js';
import { adminConnection, applySchema } from './lib/tools.js';

let connection;
try {
  connection = await adminConnection(loadConfig().database);
  await applySchema(connection, { seed: process.argv.includes('--seed') });
  console.info('Database is ready.');
} catch (error) {
  console.error(`Database installation failed (${error.code ?? error.message}). Check .env.local and that the database user may create tables.`);
  process.exitCode = 1;
} finally {
  if (connection) await connection.end();
}
