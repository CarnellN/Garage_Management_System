import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const env = { DATABASE_URL: 'postgresql://garage:password@db.example.com:5432/postgres' };
test('database connections verify TLS by default and use a bounded pool', () => {
  const config = loadConfig(env);
  assert.equal(config.port, 8000);
  assert.equal(config.database.max, 5);
  assert.equal(config.database.ssl.rejectUnauthorized, true);
});

test('invalid configuration fails without echoing credentials', () => {
  for (const change of [
    { DATABASE_URL: 'invalid-secret' }, { PORT: 'abc' }, { PORT: '0' },
    { DB_POOL_MAX: '0' }, { DB_SSL: 'invalid' }, { CORS_ORIGINS: '*' },
    { CORS_ORIGINS: 'https://example.com/path' }, { DB_SSL_CA_FILE: './not-a-certificate.pem' },
  ]) {
    assert.throws(() => loadConfig({ ...env, ...change }), (error) => !error.message.includes('invalid-secret'));
  }
});

test('TLS cannot be disabled remotely or overridden by connection URI parameters', () => {
  assert.throws(() => loadConfig({ ...env, DB_SSL: 'false' }));
  assert.throws(() => loadConfig({ ...env, DATABASE_URL: `${env.DATABASE_URL}?sslmode=no-verify` }));
  const local = { DATABASE_URL: 'postgresql://garage:password@localhost:5432/garage', DB_SSL: 'false' };
  assert.equal(loadConfig(local).database.ssl, false);
  assert.throws(() => loadConfig({ ...local, NODE_ENV: 'production', CORS_ORIGINS: 'https://garage.example.com' }));
});

test('production requires an explicit frontend origin allowlist', () => {
  assert.throws(() => loadConfig({ ...env, NODE_ENV: 'production' }));
  assert.deepEqual(loadConfig({ ...env, NODE_ENV: 'production', CORS_ORIGINS: 'https://garage.example.com' }).corsOrigins,
    ['https://garage.example.com']);
});
