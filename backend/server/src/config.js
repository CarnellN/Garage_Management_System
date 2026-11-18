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
  if (driver !== 'mysql') throw new Error('Only MySQL is supported.');
  let connectionString = env.DATABASE_URL;
  if (!connectionString && env.DB_HOST) {
    const port = boundedInteger(env.DB_PORT, 3306, 'DB_PORT', 1, 65535);
    if (!env.DB_USER || !env.DB_PASSWORD || !env.DB_NAME) {
      throw new Error('Set DB_USER, DB_PASSWORD, and DB_NAME with DB_HOST.');
    }
    connectionString = `mysql://${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}@${env.DB_HOST}:${port}/${encodeURIComponent(env.DB_NAME)}`;
  }
  let databaseUrl;
  try {
    databaseUrl = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a valid database connection URI.');
  }
  const protocols = ['mysql:'];
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
  if ([...databaseUrl.searchParams.keys()].some((key) => key.toLowerCase().startsWith('ssl'))) {
    throw new Error('Remove SSL query parameters from DATABASE_URL; use DB_SSL and DB_SSL_CA_FILE.');
  }
  const sslValue = env.DB_SSL ?? 'true';
  if (!['true', 'false'].includes(sslValue)) {
    throw new Error('DB_SSL must be true or false.');
  }
  const sslEnabled = sslValue === 'true';
  const localHosts = ['localhost', '127.0.0.1', '[::1]'];
  // DB_TRUSTED_PRIVATE_NETWORK=true is an explicit opt-in for a database that is reachable only on an
  // isolated container network (docker-compose.yml): the port is never published outside that network.
  const privateNetwork = env.DB_TRUSTED_PRIVATE_NETWORK === 'true';
  if (!sslEnabled && !privateNetwork && (nodeEnv === 'production' || !localHosts.includes(databaseUrl.hostname))) {
    throw new Error('DB_SSL=false is allowed only for a local development/test database, or with DB_TRUSTED_PRIVATE_NETWORK=true on an isolated container network.');
  }
  let ca;
  const caFile = env.DB_SSL_CA_FILE?.trim();
  const caText = env.DB_CA?.trim();
  if (caFile) {
    try {
      ca = readFileSync(caFile, 'utf8');
    } catch {
      throw new Error('DB_SSL_CA_FILE could not be read.');
    }
  } else if (caText) {
    ca = caText;
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
  if (env.JWT_SECRET && Buffer.byteLength(env.JWT_SECRET) < 32) throw new Error('JWT_SECRET must contain at least 32 bytes.');
  if (nodeEnv === 'production' && !env.JWT_SECRET) throw new Error('JWT_SECRET is required in production.');
  let schedule;
  if (env.GARAGE_OPEN_TIME || env.GARAGE_CLOSE_TIME || env.GARAGE_OPEN_DAYS) {
    const time = (value) => {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value ?? '')) throw new Error('Configure GARAGE_OPEN_TIME and GARAGE_CLOSE_TIME as HH:MM.');
      const [hour, minute] = value.split(':').map(Number);
      return hour * 60 + minute;
    };
    const open = time(env.GARAGE_OPEN_TIME), close = time(env.GARAGE_CLOSE_TIME);
    const daysText = env.GARAGE_OPEN_DAYS ?? '';
    if (!/^[0-6](,[0-6])*$/.test(daysText) || close <= open) throw new Error('Configure ordered garage hours and GARAGE_OPEN_DAYS as comma-separated weekdays (0=Sunday).');
    schedule = { open, close, days: [...new Set(daysText.split(',').map(Number))] };
  }
  if (env.LABOR_HOURLY_RATE && !/^(0|[1-9][0-9]{0,7})\.[0-9]{2}$/.test(env.LABOR_HOURLY_RATE)) throw new Error('LABOR_HOURLY_RATE must be a nonnegative DECIMAL(10,2) string.');
  const optionalText = (value) => value?.trim() || undefined;
  if (env.DATA_ENCRYPTION_KEY && Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64url').length !== 32) {
    throw new Error('DATA_ENCRYPTION_KEY must be 32 random bytes encoded as base64url.');
  }
  const appBaseUrl = env.APP_BASE_URL ?? corsOrigins[0] ?? 'http://localhost:5173';
  try { new URL(appBaseUrl); } catch { throw new Error('APP_BASE_URL must be an absolute URL.'); }
  const mpesaEnvironment = env.MPESA_ENV ?? 'sandbox';
  if (!['sandbox', 'production'].includes(mpesaEnvironment)) throw new Error('MPESA_ENV must be sandbox or production.');
  const mpesaKeys = ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE', 'MPESA_PASSKEY', 'MPESA_CALLBACK_BASE_URL', 'MPESA_CALLBACK_TOKEN'];
  const mpesaSet = mpesaKeys.filter((key) => env[key]?.trim());
  let mpesa;
  if (mpesaSet.length) {
    if (mpesaSet.length !== mpesaKeys.length) throw new Error(`Set all M-Pesa variables together: ${mpesaKeys.join(', ')}.`);
    if (!/^[A-Za-z0-9_-]{32,}$/.test(env.MPESA_CALLBACK_TOKEN)) throw new Error('MPESA_CALLBACK_TOKEN must be at least 32 URL-safe random characters.');
    let callbackBase;
    try { callbackBase = new URL(env.MPESA_CALLBACK_BASE_URL); } catch { throw new Error('MPESA_CALLBACK_BASE_URL must be an absolute https URL.'); }
    if (callbackBase.protocol !== 'https:') throw new Error('MPESA_CALLBACK_BASE_URL must use https; Safaricom only calls public https endpoints.');
    mpesa = {
      environment: mpesaEnvironment, consumerKey: env.MPESA_CONSUMER_KEY.trim(), consumerSecret: env.MPESA_CONSUMER_SECRET.trim(),
      shortcode: env.MPESA_SHORTCODE.trim(), passkey: env.MPESA_PASSKEY.trim(), callbackToken: env.MPESA_CALLBACK_TOKEN.trim(),
      transactionType: env.MPESA_TRANSACTION_TYPE === 'CustomerBuyGoodsOnline' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
      callbackUrl: `${callbackBase.origin}${callbackBase.pathname.replace(/\/$/, '')}/api/v1/payments/mpesa/callback/${env.MPESA_CALLBACK_TOKEN.trim()}`,
    };
  }
  return {
    nodeEnv,
    appBaseUrl,
    dataEncryptionKey: optionalText(env.DATA_ENCRYPTION_KEY),
    company: {
      name: optionalText(env.GARAGE_NAME) ?? 'Garage Management System',
      address: optionalText(env.GARAGE_ADDRESS), phone: optionalText(env.GARAGE_PHONE), email: optionalText(env.GARAGE_EMAIL),
      logoFile: optionalText(env.GARAGE_LOGO_FILE),
    },
    mail: {
      nodeEnv, host: optionalText(env.SMTP_HOST), port: boundedInteger(env.SMTP_PORT, 587, 'SMTP_PORT', 1, 65535),
      secure: env.SMTP_SECURE === 'true', user: optionalText(env.SMTP_USER), password: env.SMTP_PASSWORD,
      from: optionalText(env.MAIL_FROM) ?? 'Garage Management System <no-reply@garage.local>',
    },
    mpesa,
    workflows: { schedule, laborRate: env.LABOR_HOURLY_RATE || undefined },
    auth: {
      secret: env.JWT_SECRET,
      issuer: env.JWT_ISSUER ?? 'garage-management-api',
      audience: env.JWT_AUDIENCE ?? 'garage-frontend',
      ttl: boundedInteger(env.JWT_TTL_SECONDS, 900, 'JWT_TTL_SECONDS', 60, 3600),
    },
    host: env.HOST ?? '127.0.0.1',
    port: boundedInteger(env.PORT, 8000, 'PORT', 1, 65535),
    corsOrigins,
    database: {
      driver,
      connectionString,
      max: boundedInteger(env.DB_POOL_MAX, 5, 'DB_POOL_MAX', 1, 50),
      ssl: sslEnabled ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) } : false,
    },
  };
}
