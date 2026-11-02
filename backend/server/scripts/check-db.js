import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/database.js';

let database;
try {
  database = createDatabase(loadConfig().database);
  await database.check();
  console.info(`Database connection successful (${database.driver}).`);
} catch (error) {
  const reason = error.code ?? error.name;
  console.error(`Database connection failed (${reason}). Check DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME/DB_PORT, TLS settings, and network access.`);
  process.exitCode = 1;
} finally {
  if (database) await database.close();
}
