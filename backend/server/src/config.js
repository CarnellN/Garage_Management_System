import { readFileSync } from 'node:fs';

function boundedInteger(value, fallback, name, min, max) {
  const text = value ?? String(fallback);
  if (!/^\d+$/.test(text) || Number(text) < min || Number(text) > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return Number(text);
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }
  const driver = env.DB_CLIENT ?? 'mysql';
  if (!['postgres', 'mysql'].includes(driver)) throw new Error('DB_CLIENT must be postgres or mysql.');
  let databaseUrl;
  try {
    databaseUrl = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('DATABASE_URL must be a valid database connection URI.');
  }
  const protocols = driver === 'postgres' ? ['postgres:', 'postgresql:'] : ['mysql:'];
  if (!protocols.includes(databaseUrl.protocol) ||
      !databaseUrl.hostname || databaseUrl.pathname.length < 2 ||
      !databaseUrl.username || !databaseUrl.password) {
    throw new Error('DATABASE_URL must match DB_CLIENT and include a host, database, username, and password.');
  }
  if (driver === 'mysql' && (databaseUrl.search || databaseUrl.hash)) {
    throw new Error('MySQL DATABASE_URL must not contain query parameters or fragments.');
  }
  try {
    decodeURIComponent(databaseUrl.username);
    decodeURIComponent(databaseUrl.password);
    decodeURIComponent(databaseUrl.pathname.slice(1));
  } catch {
    throw new Error('DATABASE_URL contains invalid percent-encoding.');
  }
  // pg connection-string SSL options can override the explicit verified TLS config.
  if ([...databaseUrl.searchParams.keys()].some((key) => key.toLowerCase().startsWith('ssl'))) {
    throw new Error('Remove SSL query parameters from DATABASE_URL; use DB_SSL and DB_SSL_CA_FILE.');
  }
  const sslValue = env.DB_SSL ?? 'true';
  if (!['true', 'false'].includes(sslValue)) {
    throw new Error('DB_SSL must be true or false.');
  }
  const sslEnabled = sslValue === 'true';
  const localHosts = ['localhost', '127.0.0.1', '[::1]'];
  if (!sslEnabled && (nodeEnv === 'production' || !localHosts.includes(databaseUrl.hostname))) {
    throw new Error('DB_SSL=false is allowed only for a local development/test database.');
  }
  let ca;
  if (env.DB_SSL_CA_FILE?.trim()) {
    try {
      ca = readFileSync(env.DB_SSL_CA_FILE.trim(), 'utf8');
    } catch {
      throw new Error('DB_SSL_CA_FILE could not be read.');
    }
  }
  const corsOrigins = (env.CORS_ORIGINS ?? (nodeEnv === 'production' ? '' : 'http://localhost:5173'))
    .split(',').map((origin) => origin.trim()).filter(Boolean);
  if (nodeEnv === 'production' && !corsOrigins.length) {
    throw new Error('Set CORS_ORIGINS explicitly in production.');
  }
  for (const origin of corsOrigins) {
    let url;
    try { url = new URL(origin); } catch { throw new Error('CORS_ORIGINS must contain exact HTTP(S) origins.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error('CORS_ORIGINS must contain exact HTTP(S) origins without paths or wildcards.');
    }
  }
  return {
    nodeEnv,
    host: env.HOST ?? '127.0.0.1',
    port: boundedInteger(env.PORT, 8000, 'PORT', 1, 65535),
    corsOrigins,
    database: {
      driver,
      connectionString: env.DATABASE_URL,
      max: boundedInteger(env.DB_POOL_MAX, 5, 'DB_POOL_MAX', 1, 50),
      ssl: sslEnabled ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) } : false,
    },
  };
}
