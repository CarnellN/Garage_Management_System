import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/database.js';

let database;
try {
  database = createDatabase(loadConfig().database);
  await database.check();
  console.info(`Database connection successful (${database.driver}).`);
} catch {
  console.error('Database connection failed. Check DATABASE_URL, DB_SSL_CA_FILE, and network access.');
  process.exitCode = 1;
} finally {
  if (database) await database.close();
}
