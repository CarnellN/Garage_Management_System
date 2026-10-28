import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGarageClient, GarageApiError } from '../../../docs/api-client.mjs';
import { contract, operations } from '../src/api/contract.js';

test('frontend operation metadata matches the contract', () => {
  const metadata = JSON.parse(readFileSync(new URL('../../../docs/api-operations.json', import.meta.url)));
  assert.deepEqual(Object.keys(metadata).sort(), operations.map((operation) => operation.operationId).sort());
  for (const operation of operations) {
    assert.equal(metadata[operation.operationId].method, operation.method.toUpperCase());
    assert.equal(metadata[operation.operationId].path, operation.path);
  }
});

test('fetch client encodes query values, sends auth/ETag, and exposes response metadata', async () => {
  let received;
  const client = createGarageClient({ getToken: () => 'test-token', fetchImpl: async (url, options) => {
    received = { url, options };
    return new Response(JSON.stringify({ booking_id: 7 }), { status: 200, headers: { ETag: '"4"', 'X-Request-ID': 'req-1' } });
  } });
  const result = await client.rescheduleBooking({ path: { bookingId: 7 }, body: { scheduled_at: '2030-01-07T09:00:00+03:00', ends_at: '2030-01-07T10:00:00+03:00' }, etag: '"3"' });
  assert.equal(received.url.pathname, '/api/v1/bookings/7');
  assert.equal(received.options.headers.Authorization, 'Bearer test-token');
  assert.equal(received.options.headers['If-Match'], '"3"');
  assert.equal(result.etag, '"4"');
  assert.equal(result.requestId, 'req-1');
  await client.listBookings({ query: { from: '2030-01-07T09:00:00+03:00' } });
  assert.equal(received.url.searchParams.get('from'), '2030-01-07T09:00:00+03:00');
});

test('client enforces required retry keys and exposes server field errors without retries', async () => {
  let calls = 0;
  const client = createGarageClient({ fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify({ code: 'VALIDATION_ERROR', message: 'Check fields.', request_id: 'req-bad', details: [{ field: 'registration_no', message: 'invalid' }] }), { status: 422 });
  } });
  await assert.rejects(client.createVehicle({ body: {} }), /Idempotency-Key/);
  assert.equal(calls, 0);
  await assert.rejects(client.createVehicle({ body: {}, idempotencyKey: 'retry-key-00000001' }), (error) => {
    assert.ok(error instanceof GarageApiError);
    assert.equal(error.status, 422); assert.equal(error.requestId, 'req-bad');
    assert.equal(error.details[0].field, 'registration_no'); return true;
  });
  assert.equal(calls, 1);
});

test('client handles 204 without parsing JSON and does not swallow network errors', async () => {
  const client = createGarageClient({ fetchImpl: async () => new Response(null, { status: 204 }) });
  assert.equal((await client.logout()).data, null);
  const original = new Error('Network unavailable');
  const failing = createGarageClient({ fetchImpl: async () => { throw original; } });
  await assert.rejects(failing.getCurrentUser(), (error) => error === original);
});
