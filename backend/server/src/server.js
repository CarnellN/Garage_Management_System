import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './database.js';
import { createMailer } from './services/mailer.js';
import { createMpesa } from './services/mpesa.js';

async function main() {
  const config = loadConfig();
  const database = createDatabase(config.database);
  let server;
  try {
    await database.check();
    const mpesa = config.mpesa ? Object.assign(createMpesa(config.mpesa), { callbackToken: config.mpesa.callbackToken }) : undefined;
    const app = createApp({
      database, corsOrigins: config.corsOrigins, auth: config.auth, workflows: config.workflows,
      mailer: createMailer(config.mail), mpesa, company: config.company, appBaseUrl: config.appBaseUrl, dataEncryptionKey: config.dataEncryptionKey,
    });
    server = await new Promise((resolve, reject) => {
      const listener = app.listen(config.port, config.host);
      listener.once('error', reject);
      listener.once('listening', () => resolve(listener));
    });
  } catch {
    await database.close();
    throw new Error('Startup failed. Check database credentials, TLS/network access, and HOST/PORT.');
  }
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  console.info({ event: 'server_started', host: config.host, port: config.port, mpesa: config.mpesa ? config.mpesa.environment : 'not configured', smtp: Boolean(config.mail.host) });

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    console.info({ event: 'server_stopping' });
    const deadline = setTimeout(() => {
      console.error({ event: 'shutdown_timeout' });
      server.closeAllConnections();
      process.exit(1);
    }, 10000);
    deadline.unref();
    server.close(async () => {
      try { await database.close(); } catch { process.exitCode = 1; }
      clearTimeout(deadline);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error) => {
  // Only configuration errors and our sanitized startup error reach this handler.
  console.error(error.message);
  process.exitCode = 1;
});
