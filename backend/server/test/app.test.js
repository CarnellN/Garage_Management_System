import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';

const logger = { info() {}, error() {} };
async function serve(t, check = async () => {}) {
  const app = createApp({ database: { check }, corsOrigins: ['http://localhost:5173'], logger });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('liveness works without querying the database; responses carry security headers', async (t) => {
  const url = await serve(t, async () => { throw new Error('Must not query'); });
  const res = await fetch(`${url}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.ok(res.headers.get('x-request-id'));
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('readiness verifies database connectivity', async (t) => {
  let calls = 0;
  const url = await serve(t, async () => { calls++; });
  const res = await fetch(`${url}/health/ready`);
  assert.equal(res.status, 200);
  assert.equal(calls, 1);
});

test('database failures return 503 with correlation and no leaked secrets', async (t) => {
  const url = await serve(t, async () => { throw new Error('postgres://secret-password'); });
  const res = await fetch(`${url}/health/ready`);
  const body = await res.json();
  assert.equal(res.status, 503);
  assert.equal(body.code, 'DATABASE_UNAVAILABLE');
  assert.equal(body.request_id, res.headers.get('x-request-id'));
  assert.equal(res.headers.get('retry-after'), '5');
  assert.ok(!JSON.stringify(body).includes('secret-password'));
});

test('CORS preflight permits configured origins and required contract headers', async (t) => {
  const url = await serve(t);
  const res = await fetch(`${url}/api/v1/bookings`, {
    method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.match(res.headers.get('access-control-allow-headers'), /Idempotency-Key/);
  const denied = await fetch(`${url}/health`, { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  const sameOrigin = await fetch(`${url}/health`, { headers: { Origin: url } });
  assert.equal(sameOrigin.status, 200);
  assert.equal(sameOrigin.headers.get('access-control-allow-origin'), url);
});

test('unknown endpoints and malformed JSON follow the contract error envelope', async (t) => {
  const url = await serve(t);
  const missing = await fetch(`${url}/api/v1/unknown-resource`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, 'NOT_FOUND');
  const malformed = await fetch(`${url}/api/v1/customers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code, 'INVALID_JSON');
});
