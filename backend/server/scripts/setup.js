// Installation wizard: writes .env.local, checks the database, installs tables and creates the first admin.
//   cd backend/server && npm install && npm run setup
import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { adminConnection, applySchema, prompter, validEmail } from './lib/tools.js';
import { createAdmin } from './create-admin.js';

const envFile = new URL('../.env.local', import.meta.url);
const io = prompter();
const line = () => console.info('-'.repeat(64));
const quote = (value) => /[\s#"'=]/.test(value) ? `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"` : value;

try {
  console.info('\nGarage Management System — installation wizard');
  line();
  if (existsSync(envFile) && !await io.confirm('backend/server/.env.local already exists. Replace it?', false)) {
    console.info('Keeping the existing .env.local. Continuing with database installation.');
  } else {
    console.info('1/4  Database (MySQL 8.0.16+)');
    const host = await io.ask('MySQL host', 'localhost');
    const port = await io.ask('MySQL port', '3306');
    const name = await io.ask('Database name', 'garage_management_db');
    const user = await io.ask('Database user', 'garage_user');
    const password = await io.secret('Database password');
    const local = ['localhost', '127.0.0.1'].includes(host);
    const ssl = local ? await io.confirm('Use TLS for this local database?', false) : true;
    const ca = ssl && !local ? await io.ask('Path to the provider CA certificate (blank to use system CAs)', '') : '';
    line();
    console.info('2/4  Garage details (shown on reports and invoices)');
    const garage = await io.ask('Garage name', 'Garage Management System');
    const address = await io.ask('Address', 'Nairobi, Kenya');
    const phone = await io.ask('Phone', '+254 700 000 000');
    const email = await io.ask('Email', 'info@garage.local');
    const open = await io.ask('Opening time (HH:MM, Nairobi)', '08:00');
    const close = await io.ask('Closing time (HH:MM, Nairobi)', '17:00');
    const days = await io.ask('Open days (0=Sun … 6=Sat)', '1,2,3,4,5,6');
    const rate = await io.ask('Labour rate per hour in KES (e.g. 1000.00)', '1000.00');
    const frontend = await io.ask('Frontend URL', 'http://localhost:5173');
    line();
    const env = {
      NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '8000', CORS_ORIGINS: frontend, APP_BASE_URL: frontend,
      JWT_SECRET: randomBytes(48).toString('base64url'), DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
      JWT_TTL_SECONDS: '900', GARAGE_NAME: garage, GARAGE_ADDRESS: address, GARAGE_PHONE: phone, GARAGE_EMAIL: email,
      GARAGE_OPEN_TIME: open, GARAGE_CLOSE_TIME: close, GARAGE_OPEN_DAYS: days, LABOR_HOURLY_RATE: rate,
      DB_CLIENT: 'mysql', DB_HOST: host, DB_PORT: port, DB_USER: user, DB_PASSWORD: password, DB_NAME: name,
      DB_SSL: String(ssl), DB_SSL_CA_FILE: ca, DB_POOL_MAX: '5',
    };
    // Validate before writing so a typo is reported now rather than when the server starts.
    loadConfig(env);
    const body = Object.entries(env).map(([key, value]) => `${key}=${quote(value)}`).join('\n');
    writeFileSync(envFile, `# Written by npm run setup. Keep this file private; it holds secrets.\n# Add SMTP_* and MPESA_* settings here when available (see .env.example).\n${body}\n`, { mode: 0o600 });
    console.info('3/4  Wrote backend/server/.env.local (secrets generated locally).');
    Object.assign(process.env, env);
  }
  if (existsSync(envFile)) process.loadEnvFile?.(envFile);
  const config = loadConfig();
  line();
  console.info('4/4  Database installation');
  if (await io.confirm('Create or upgrade the tables now?', true)) {
    const connection = await adminConnection(config.database);
    try {
      await applySchema(connection, { seed: await io.confirm('Load demo data (sample customers, staff, jobs)?', false) });
    } finally { await connection.end(); }
  }
  if (await io.confirm('Create an administrator account?', true)) {
    const name = await io.ask('Admin full name', 'System Administrator');
    let email = '';
    while (!validEmail(email)) email = await io.ask('Admin email');
    let password = '';
    while (password.length < 12) password = await io.secret('Admin password (12+ characters)');
    const { userId, created } = await createAdmin(config.database, { name, email, password });
    console.info(`${created ? 'Created' : 'Updated'} admin account #${userId}.`);
  }
  line();
  console.info('Setup complete. Start the API with:  npm run dev   (http://127.0.0.1:8000/api/docs)');
} catch (error) {
  console.error(`\nSetup stopped: ${error.code ? `${error.code} — check the host, port, credentials and that MySQL is running.` : error.message}`);
  process.exitCode = 1;
} finally {
  io.close();
}
