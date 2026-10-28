import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const env = { DATABASE_URL: 'mysql://garage:password@db.example.com:3306/garage_management_db' };
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
  const local = { DATABASE_URL: 'mysql://garage:password@localhost:3306/garage', DB_SSL: 'false' };
  assert.equal(loadConfig(local).database.ssl, false);
  assert.throws(() => loadConfig({ ...local, NODE_ENV: 'production', CORS_ORIGINS: 'https://garage.example.com' }));
});

test('production requires an explicit frontend origin allowlist', () => {
  assert.throws(() => loadConfig({ ...env, NODE_ENV: 'production' }));
  assert.deepEqual(loadConfig({ ...env, NODE_ENV: 'production', CORS_ORIGINS: 'https://garage.example.com' }).corsOrigins,
    ['https://garage.example.com']);
});

test('MySQL is the default; Postgres remains an explicitly selected backup', () => {
  assert.equal(loadConfig(env).database.driver, 'mysql');
  const postgres = { DB_CLIENT: 'postgres', DATABASE_URL: 'postgresql://garage:password@db.example.com:5432/postgres' };
  assert.equal(loadConfig(postgres).database.driver, 'postgres');
  assert.throws(() => loadConfig({ DATABASE_URL: postgres.DATABASE_URL }));
  const mysql = { DB_CLIENT: 'mysql', DATABASE_URL: 'mysql://garage:password@localhost:3306/garage_management_db', DB_SSL: 'false' };
  assert.equal(loadConfig(mysql).database.driver, 'mysql');
  assert.throws(() => loadConfig({ ...env, DB_CLIENT: 'sqlite' }));
  assert.throws(() => loadConfig({ ...env, DB_CLIENT: 'postgres' }));
  assert.throws(() => loadConfig({ ...mysql, DB_CLIENT: 'postgres' }));
  assert.throws(() => loadConfig({ ...mysql, DATABASE_URL: `${mysql.DATABASE_URL}?multipleStatements=true` }));
  assert.throws(() => loadConfig({ ...mysql, DATABASE_URL: 'mysql://garage:%XX@localhost/garage' }));
});

test('remote MySQL requires verified TLS, including in development', () => {
  const mysql = { DB_CLIENT: 'mysql', DATABASE_URL: 'mysql://garage:password@mysql.example.com/garage_management_db' };
  assert.equal(loadConfig(mysql).database.ssl.rejectUnauthorized, true);
  assert.throws(() => loadConfig({ ...mysql, DB_SSL: 'false' }));
});
