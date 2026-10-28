import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { SignJWT } from 'jose';
import { createApp } from '../src/app.js';
import { createSecurity, hashPassword, verifyPassword } from '../src/api/security.js';
import { createStore } from '../src/api/sql.js';
import { contract, operations } from '../src/api/contract.js';
import { fakeDatabase } from './support/fake-database.js';

const auth = { secret: 'test-only-random-like-secret-of-at-least-32-bytes' };
const logger = { info() {}, error() {} };
async function setup(t, driver = 'mysql') {
  const database = fakeDatabase(driver);
  const baseQuery = database.query.bind(database);
  database.query = async (sql, values = []) => {
    const plain = sql.replace(/["`]/g, '');
    if (plain.includes('FROM BOOKING WHERE') && plain.includes('scheduled_at <')) {
      database.queries.push({ sql, values });
      const rows = database.rows('BOOKING').filter((row) => ['PENDING','CONFIRMED','CHECKED_IN'].includes(row.status) &&
        +new Date(row.scheduled_at) < +new Date(values[0]) && +new Date(row.ends_at) > +new Date(values[1]) && row.booking_id !== values[2]);
      return { rows: structuredClone(rows), rowCount: rows.length };
    }
    if (plain.includes('FROM JOB_PARTS jp JOIN PART p')) {
      database.queries.push({ sql, values });
      const rows = database.rows('JOB_PARTS').filter((row) => row.job_card_id === values[0]).map((row) => ({ ...row, name: database.rows('PART').find((part) => part.part_id === row.part_id).name }));
      return { rows: structuredClone(rows), rowCount: rows.length };
    }
    return baseQuery(sql, values);
  };
  const app = createApp({ database, auth, logger, workflows: { schedule: { open: 480, close: 1020, days: [1,2,3,4,5,6] }, laborRate: '1000.00' } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = 'GET', token, body, headers = {} } = {}) => {
    const response = await fetch(`${base}${path.startsWith('/api/') ? '' : '/api/v1'}${path}`, {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const result = response.status === 204 ? null : await response.json();
    return { status: response.status, body: result, headers: response.headers };
  };
  const account = async (role = 'CUSTOMER', customer_id = 1) => {
    const user = { user_id: database.rows('USER').length + 1, name: `${role} User`, role, email: `${role.toLowerCase()}${database.rows('USER').length}@example.com`, active: true, customer_id: role === 'CUSTOMER' ? customer_id : null, password_hash: 'not-exposed' };
    database.seed('USER', user);
    const session = await createSecurity(database, auth).session(createStore(database), user);
    return { user, token: session.access_token };
  };
  return { database, request, account };
}
function assertSchema(name, value) {
  const ajv = new Ajv({ strict: false }); addFormats(ajv); ajv.addFormat('int32', true);
  const validate = ajv.compile({ ...contract.components.schemas[name], components: contract.components });
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
}

test('discovery and contract identify 53 implemented operations and two provider-dependent operations', async (t) => {
  const { request } = await setup(t);
  const result = await request('/');
  assert.equal(result.status, 200);
  assert.equal(result.body.operations.length, 55);
  assert.equal(result.body.operations.filter((operation) => operation.implemented).length, 53);
  assert.equal(result.body.operations.filter((operation) => operation.requiresPaymentProvider).length, 2);
  assert.equal((await request('/api/openapi.json')).body.openapi, '3.0.3');
});

test('protected routes reject unauthenticated requests and forbidden roles', async (t) => {
  const { request, account } = await setup(t);
  const guest = await request('/vehicles');
  assert.equal(guest.status, 401);
  assert.equal(guest.headers.get('www-authenticate'), 'Bearer');
  const { token } = await account('MECHANIC');
  assert.equal((await request('/customers', { token })).status, 403);
});

test('registration creates linked accounts, hashes passwords, and returns a usable bearer session', async (t) => {
  const { database, request } = await setup(t);
  const password = 'A lengthy password 123';
  const registration = await request('/auth/register', { method: 'POST', body: { name: 'Jane Doe', email: 'Jane@example.com', password } });
  assert.equal(registration.status, 201);
  assertSchema('AuthSession', registration.body);
  assert.equal(registration.body.user.role, 'CUSTOMER');
  assert.equal(registration.body.user.customer_id, database.rows('CUSTOMER')[0].customer_id);
  assert.ok(!JSON.stringify(registration.body).includes('password_hash'));
  assert.notEqual(database.rows('USER')[0].password_hash, password);
  assert.equal(await verifyPassword(password, database.rows('USER')[0].password_hash), true);
  const me = await request('/auth/me', { token: registration.body.access_token });
  assert.equal(me.status, 200);
  assertSchema('User', me.body);
  const login = await request('/auth/login', { method: 'POST', body: { email: 'jane@example.com', password } });
  assert.equal(login.status, 200);
  const logout = await request('/auth/logout', { method: 'POST', token: login.body.access_token });
  assert.equal(logout.status, 204);
  assert.equal((await request('/auth/me', { token: login.body.access_token })).status, 401);
});

test('duplicate registration rolls back the new profile and hides constraint details', async (t) => {
  const { database, request } = await setup(t);
  const body = { name: 'Jane', email: 'jane@example.com', password: 'Long enough password' };
  assert.equal((await request('/auth/register', { method: 'POST', body })).status, 201);
  const duplicate = await request('/auth/register', { method: 'POST', body });
  assert.equal(duplicate.status, 409);
  assert.equal(database.rows('CUSTOMER').length, 1);
  assert.ok(!JSON.stringify(duplicate.body).includes('secret database'));
});

for (const driver of ['mysql', 'postgres']) {
  test(`${driver}: customer vehicle creation, response contract, pagination, isolation and idempotency`, async (t) => {
    const { database, request, account } = await setup(t, driver);
    database.seed('CUSTOMER', { customer_id: 1, name: 'Jane', phone: null, email: null });
    database.seed('CUSTOMER', { customer_id: 2, name: 'Someone else', phone: null, email: null });
    const { token } = await account();
    const options = { method: 'POST', token, body: { customer_id: 1, registration_no: ' kda 123a ', make: 'Toyota' }, headers: { 'Idempotency-Key': 'vehicle-create-key-0001' } };
    const created = await request('/vehicles', options);
    assert.equal(created.status, 201);
    assertSchema('Vehicle', created.body);
    assert.equal(created.body.registration_no, 'KDA 123A');
    assert.equal(created.headers.get('location'), '/api/v1/vehicles/1');
    const replay = await request('/vehicles', options);
    assert.equal(replay.status, 201);
    assert.deepEqual(replay.body, created.body);
    assert.equal(database.rows('VEHICLE').length, 1);
    assert.equal((await request('/vehicles', { ...options, body: { ...options.body, registration_no: 'DIFFERENT' } })).status, 409);
    const listing = await request('/vehicles?page=1&page_size=10', { token });
    assert.equal(listing.status, 200);
    assertSchema('VehicleList', listing.body);
    assert.equal(listing.body.pagination.total, 1);
    assert.equal((await request('/vehicles?customer_id=2', { token })).status, 404);
    assert.equal((await request('/vehicles', { ...options, body: { customer_id: 2, registration_no: 'KDB 123B' }, headers: { 'Idempotency-Key': 'vehicle-create-key-0002' } })).status, 404);
    assert.ok(database.queries.some(({ sql, values }) => sql.startsWith('INSERT') && values.includes('KDA 123A') && !sql.includes('KDA 123A')));
  });
}

test('validation rejects role injection, unknown fields, overflow IDs, and missing idempotency keys', async (t) => {
  const { database, request, account } = await setup(t);
  const injection = await request('/auth/register', { method: 'POST', body: { name: 'Bad', email: 'bad@example.com', password: 'Long enough password', role: 'ADMIN' } });
  assert.equal(injection.status, 422);
  assert.ok(injection.body.details.some((detail) => detail.field === 'role'));
  const { token } = await account();
  assert.equal((await request('/vehicles?page_size=101', { token })).status, 422);
  assert.equal((await request('/vehicles/2147483648', { token })).status, 422);
  assert.equal((await request('/vehicles?unknown=1', { token })).status, 422);
  assert.equal((await request('/vehicles', { method: 'POST', token, body: { customer_id: 1, registration_no: 'KDA' } })).status, 400);
  assert.equal(database.rows('VEHICLE').length, 0);
});

test('customer cannot access another vehicle; mechanic cannot access another assignment', async (t) => {
  const { database, request, account } = await setup(t);
  database.seed('VEHICLE', { vehicle_id: 1, customer_id: 2, registration_no: 'KDA 123A', make: null, model: null });
  const customer = await account();
  assert.equal((await request('/vehicles/1', { token: customer.token })).status, 404);
  const mechanic = await account('MECHANIC');
  database.seed('JOB_CARD', { job_card_id: 1, vehicle_id: 1, mechanic_id: 999, booking_id: null, opened_at: new Date(), status: 'OPEN', version: 1 });
  assert.equal((await request('/job-cards/1', { token: mechanic.token })).status, 404);
});

test('job writes require a current ETag and prevent edits after completion', async (t) => {
  const { database, request, account } = await setup(t);
  const { token, user } = await account('MECHANIC');
  database.seed('JOB_CARD', { job_card_id: 1, vehicle_id: 1, mechanic_id: user.user_id, booking_id: null, opened_at: new Date(), status: 'OPEN', version: 3 });
  const body = { name: 'Oil change', standard_hours: '1.50' };
  const options = { method: 'POST', token, body, headers: { 'Idempotency-Key': 'job-task-create-0001' } };
  assert.equal((await request('/job-cards/1/tasks', options)).status, 428);
  assert.equal((await request('/job-cards/1/tasks', { ...options, headers: { ...options.headers, 'If-Match': '"2"' } })).status, 412);
  const created = await request('/job-cards/1/tasks', { ...options, headers: { ...options.headers, 'If-Match': '"3"' } });
  assert.equal(created.status, 201);
  assertSchema('Task', created.body);
  assert.equal(created.headers.get('etag'), '"4"');
  database.rows('JOB_CARD')[0].status = 'COMPLETED';
  const blocked = await request('/job-cards/1/tasks', { ...options, headers: { 'Idempotency-Key': 'job-task-create-0002', 'If-Match': '"4"' } });
  assert.equal(blocked.status, 409);
});

test('settled payments use exact decimals, enforce positive balance, and disallow customer attestation', async (t) => {
  const { database, request, account } = await setup(t);
  const staff = await account('RECEPTIONIST');
  database.seed('VEHICLE', { vehicle_id: 1, customer_id: 1, registration_no: 'KDA', make: null, model: null });
  database.seed('JOB_CARD', { job_card_id: 1, vehicle_id: 1, mechanic_id: 9, booking_id: null, status: 'COMPLETED', version: 1, opened_at: new Date() });
  database.seed('INVOICE', { invoice_id: 1, job_card_id: 1, total_amount: '0.30', issued_at: new Date() });
  database.seed('INVOICE_LINE', { line_id: 1, invoice_id: 1, kind: 'PART', description: 'Test part', quantity: '1.00', unit_price: '0.30', line_total: '0.30' });
  const options = { method: 'POST', token: staff.token, headers: { 'Idempotency-Key': 'record-payment-0001' }, body: { amount: '0.10', method: 'CASH' } };
  assert.equal((await request('/invoices/1/payments', options)).status, 201);
  const invoice = await request('/invoices/1', { token: staff.token });
  assertSchema('Invoice', invoice.body);
  assert.equal(invoice.body.balance_due, '0.20');
  assert.equal(invoice.body.payment_status, 'PARTIALLY_PAID');
  assert.equal((await request('/invoices/1/payments', { ...options, headers: { 'Idempotency-Key': 'record-payment-0002' }, body: { amount: '0.21', method: 'CASH' } })).status, 409);
  assert.equal((await request('/invoices/1/payments', { ...options, body: { amount: '0.00', method: 'CASH' }, headers: { 'Idempotency-Key': 'record-payment-0003' } })).status, 422);
  const customer = await account('CUSTOMER');
  assert.equal((await request('/invoices/1/payments', { ...options, token: customer.token })).status, 403);
  const checkout = await request('/invoices/1/payment-intents', { method: 'POST', token: customer.token, headers: { 'Idempotency-Key': 'checkout-intent-0001' }, body: { amount: '0.20', method: 'CARD' } });
  assert.equal(checkout.status, 503);
  assert.equal(checkout.body.code, 'PAYMENT_PROVIDER_NOT_CONFIGURED');
  assert.equal(database.rows('PAYMENT').length, 1);
});

test('tampered, expired and disabled-account tokens are rejected', async (t) => {
  const { database, request, account } = await setup(t);
  const { token, user } = await account();
  assert.equal((await request('/auth/me', { token: `${token.slice(0, -5)}xxxxx` })).status, 401);
  const expired = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(String(user.user_id)).setJti('expired')
    .setIssuer('garage-management-api').setAudience('garage-frontend').setIssuedAt().setExpirationTime('1 second ago').sign(new TextEncoder().encode(auth.secret));
  assert.equal((await request('/auth/me', { token: expired })).status, 401);
  database.rows('USER')[0].active = false;
  assert.equal((await request('/auth/me', { token })).status, 401);
});

test('booking reservations reject overlaps, permit adjacency, check hours, and enforce reschedule ETags', async (t) => {
  const { database, request, account } = await setup(t);
  database.seed('BAY', { bay_id: 1, enabled: true });
  database.seed('VEHICLE', { vehicle_id: 1, customer_id: 1, registration_no: 'KDA', make: null, model: null });
  const { token } = await account();
  const options = { method: 'POST', token, body: { vehicle_id: 1, scheduled_at: '2030-01-07T09:00:00+03:00', ends_at: '2030-01-07T10:00:00+03:00' }, headers: { 'Idempotency-Key': 'booking-create-0001' } };
  const booked = await request('/bookings', options);
  assert.equal(booked.status, 201);
  assertSchema('Booking', booked.body);
  assert.equal(booked.body.scheduled_at, '2030-01-07T06:00:00.000Z');
  assert.equal((await request('/bookings', { ...options, headers: { 'Idempotency-Key': 'booking-create-0002' } })).status, 409);
  const adjacent = await request('/bookings', { ...options, headers: { 'Idempotency-Key': 'booking-create-0003' }, body: { vehicle_id: 1, scheduled_at: '2030-01-07T10:00:00+03:00', ends_at: '2030-01-07T11:00:00+03:00' } });
  assert.equal(adjacent.status, 201);
  const closedHours = await request('/bookings', { ...options, headers: { 'Idempotency-Key': 'booking-create-0004' }, body: { vehicle_id: 1, scheduled_at: '2030-01-07T19:00:00+03:00', ends_at: '2030-01-07T20:00:00+03:00' } });
  assert.equal(closedHours.status, 422);
  const reschedule = { method: 'PATCH', token, body: { scheduled_at: '2030-01-07T11:00:00+03:00', ends_at: '2030-01-07T12:00:00+03:00' }, headers: { 'If-Match': '"0"' } };
  assert.equal((await request('/bookings/1', reschedule)).status, 412);
  const moved = await request('/bookings/1', { ...reschedule, headers: { 'If-Match': '"1"' } });
  assert.equal(moved.status, 200);
  assert.equal(moved.headers.get('etag'), '"2"');
  assert.ok(database.queries.some(({ sql }) => /BAY.*FOR UPDATE/.test(sql)));
  assert.ok(database.queries.some(({ sql }) => /BOOKING.*scheduled_at.*FOR UPDATE/.test(sql)));
});

for (const driver of ['mysql', 'postgres']) {
  test(`${driver}: job-to-invoice-to-payment workflow calculates immutable exact totals`, async (t) => {
    const { database, request, account } = await setup(t, driver);
    const staff = await account('RECEPTIONIST');
    const mechanic = await account('MECHANIC');
    database.seed('VEHICLE', { vehicle_id: 1, customer_id: 1, registration_no: 'KDA', make: null, model: null });
    database.seed('PART', { part_id: 1, name: 'Filter', unit_price: '10.01' });
    const opened = await request('/job-cards', { method: 'POST', token: staff.token, body: { vehicle_id: 1, mechanic_id: mechanic.user.user_id }, headers: { 'Idempotency-Key': 'job-open-0000001' } });
    assert.equal(opened.status, 201);
    assertSchema('JobCard', opened.body);
    const path = `/job-cards/${opened.body.job_card_id}`;
    const started = await request(`${path}/status`, { method: 'PATCH', token: mechanic.token, body: { status: 'IN_PROGRESS' }, headers: { 'If-Match': opened.headers.get('etag') } });
    assert.equal(started.status, 200);
    const task = await request(`${path}/tasks`, { method: 'POST', token: mechanic.token, body: { name: 'Repair', standard_hours: '1.25' }, headers: { 'If-Match': started.headers.get('etag'), 'Idempotency-Key': 'task-create-00001' } });
    assert.equal(task.status, 201);
    const usedPart = await request(`${path}/parts/1`, { method: 'PUT', token: mechanic.token, body: { quantity: 3 }, headers: { 'If-Match': task.headers.get('etag') } });
    assert.equal(usedPart.status, 200);
    assertSchema('JobPart', usedPart.body);
    database.rows('PART')[0].unit_price = '999.00';
    const complete = await request(`${path}/status`, { method: 'PATCH', token: mechanic.token, body: { status: 'COMPLETED' }, headers: { 'If-Match': usedPart.headers.get('etag') } });
    assert.equal(complete.status, 200);
    const issued = await request('/invoices', { method: 'POST', token: staff.token, body: { job_card_id: opened.body.job_card_id }, headers: { 'Idempotency-Key': 'invoice-create-001' } });
    assert.equal(issued.status, 201);
    assertSchema('Invoice', issued.body);
    assert.equal(issued.body.total_amount, '1280.03');
    assert.equal(issued.body.lines.find((line) => line.kind === 'PART').unit_price, '10.01');
    assert.equal(issued.body.lines.find((line) => line.kind === 'LABOR').line_total, '1250.00');
    const secondInvoice = await request('/invoices', { method: 'POST', token: staff.token, body: { job_card_id: opened.body.job_card_id }, headers: { 'Idempotency-Key': 'invoice-create-002' } });
    assert.equal(secondInvoice.status, 409);
    const paid = await request(`/invoices/${issued.body.invoice_id}/payments`, { method: 'POST', token: staff.token, body: { amount: '1280.03', method: 'CASH' }, headers: { 'Idempotency-Key': 'payment-record-001' } });
    assert.equal(paid.status, 201);
    assertSchema('Payment', paid.body);
    const closed = await request(`${path}/status`, { method: 'PATCH', token: staff.token, body: { status: 'CLOSED' }, headers: { 'If-Match': complete.headers.get('etag') } });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.status, 'CLOSED');
    const invoice = await request(`/invoices/${issued.body.invoice_id}`, { token: staff.token });
    assert.equal(invoice.body.payment_status, 'PAID');
    assert.ok(database.rows('AUDIT_EVENT').some((event) => event.action === 'recordPayment' && event.outcome === 'SUCCESS'));
    for (const query of database.queries) {
      const placeholders = [...query.sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
      if (driver === 'postgres' && placeholders.length) assert.equal(Math.max(...placeholders), query.values.length);
    }
  });
}
