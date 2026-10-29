import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import mysql from 'mysql2/promise';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/database.js';
import { createStore } from '../src/api/sql.js';
import { hashPassword } from '../src/api/security.js';
import { operations } from '../src/api/contract.js';

const exec = promisify(execFile);
const docker = async (...args) => (await exec('docker', args, { timeout: 600000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// This test creates its own container/database; it never loads .env or DATABASE_URL.
test('official schema and API against isolated MySQL 8.0', { timeout: 600000 }, async (t) => {
  const name = `garage-api-test-${randomUUID()}`;
  const password = 'disposable-integration-test-only';
  let container, database, server;
  t.after(async () => {
    try {
      if (server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
      if (database) await database.close();
    } finally {
      if (container) {
        // Only stop the container returned by this run, with its expected identity label.
        const label = await docker('inspect', '--format', '{{index .Config.Labels "com.garage.integration"}}', container);
        assert.equal(label, name);
        await docker('stop', '--time', '1', container); // --rm removes only our disposable container.
        t.diagnostic('Disposable MySQL container removed.');
      }
    }
  });
  t.diagnostic('Starting disposable mysql:8.0 (Docker may download the image on first run).');
  container = await docker('run', '--detach', '--rm', '--name', name,
    '--label', `com.garage.integration=${name}`, '--tmpfs', '/var/lib/mysql:rw',
    '--env', `MYSQL_ROOT_PASSWORD=${password}`, '--env', 'MYSQL_DATABASE=garage_api_test',
    '--publish', '127.0.0.1::3306', 'mysql:8.0', '--default-time-zone=+03:00');
  const port = JSON.parse(await docker('inspect', container))[0].NetworkSettings.Ports['3306/tcp'][0].HostPort;
  const dbConfig = { driver: 'mysql', connectionString: `mysql://root:${password}@127.0.0.1:${port}/garage_api_test`, max: 12, ssl: false };
  const logger = { info() {}, error(entry) { t.diagnostic(JSON.stringify(entry)); } };
  database = createDatabase(dbConfig, logger);
  const transaction = database.transaction.bind(database);
  database.transaction = async (work) => {
    try { return await transaction(work); }
    catch (error) {
      if (!error.status) t.diagnostic(`Real database transaction error: ${error.code ?? error.name}: ${error.message}`);
      throw error;
    }
  };
  const deadline = Date.now() + 120000;
  let ready = false;
  while (Date.now() < deadline) {
    try { await database.check(); ready = true; break; } catch { await delay(1000); }
  }
  if (!ready) {
    t.diagnostic(await docker('logs', '--tail', '30', container));
    assert.fail('Disposable MySQL did not become ready within 120 seconds.');
  }
  const ddl = readFileSync(new URL('../../database/schema.sql', import.meta.url), 'utf8');
  // Multi-statements are permitted only for the trusted DDL in this disposable test database.
  const bootstrap = await mysql.createConnection({ host: '127.0.0.1', port: Number(port), user: 'root', password, database: 'garage_api_test', multipleStatements: true });
  try { await bootstrap.query(ddl); } finally { await bootstrap.end(); }
  const store = createStore(database);
  await t.test('official DDL installs unchanged; Linux table names and UTC connections are enforced', async () => {
    const rows = (await database.query('SHOW TABLES')).rows;
    assert.equal(rows.length, 16);
    const config = (await database.query('SELECT @@lower_case_table_names AS table_case, @@session.time_zone AS zone')).rows[0];
    assert.equal(Number(config.table_case), 0);
    assert.equal(config.zone, '+00:00');
    t.diagnostic(`Real MySQL version: ${(await database.query('SELECT VERSION() AS version')).rows[0].version}`);
    await database.transaction(async (tx) => {
      // A real transaction has already begun; the adapter's isolation configuration must be valid SQL.
      assert.equal(Number((await tx.query('SELECT 1 AS value')).rows[0].value), 1);
    });
  });
  const loginPassword = 'Integration password long enough 123';
  await store.insert('USER', { name: 'Bootstrap Admin', email: 'admin@example.com', password_hash: await hashPassword(loginPassword), role: 'ADMIN', active: true, customer_id: null }, 'user_id');
  await store.insert('BAY', { name: 'Bay One', enabled: true }, 'bay_id');
  const auth = { secret: randomUUID() + randomUUID() };
  const app = createApp({ database, auth, logger, workflows: { schedule: { open: 480, close: 1020, days: [0,1,2,3,4,5,6] }, laborRate: '1000.00' } });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const exercised = new Set();
  let admin;
  async function call(method, path, { token = admin?.access_token, body, key = randomUUID(), etag, expected = 200 } = {}) {
    const operation = operations.find((op) => op.method.toUpperCase() === method && new RegExp(`^${op.path.replace(/\{\w+\}/g, '[^/]+')}$`).test(path.split('?')[0]));
    if (operation) exercised.add(operation.operationId);
    const response = await fetch(`${base}${path}`, { method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method === 'POST' ? { 'Idempotency-Key': key } : {}), ...(etag ? { 'If-Match': etag } : {}),
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const data = response.status === 204 ? null : await response.json();
    const result = { status: response.status, data, etag: response.headers.get('ETag'), location: response.headers.get('Location') };
    if (expected !== null) assert.equal(result.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
    return result;
  }
  admin = (await call('POST', '/auth/login', { body: { email: 'admin@example.com', password: loginPassword } })).data;
  const staff = [];
  for (const [index, role] of ['RECEPTIONIST','RECEPTIONIST','MECHANIC','MECHANIC'].entries()) {
    const email = `staff${index}@example.com`;
    const user = (await call('POST', '/users', { body: { name: `Staff ${index}`, email, password: loginPassword, role }, expected: 201 })).data;
    const session = (await call('POST', '/auth/login', { body: { email, password: loginPassword } })).data;
    staff.push({ ...session, user });
  }
  const customers = [];
  for (let index = 0; index < 2; index++) {
    const session = (await call('POST', '/auth/register', { token: null, body: { name: `Customer ${index}`, email: `customer${index}@example.com`, password: loginPassword }, expected: 201 })).data;
    const vehicle = (await call('POST', '/vehicles', { token: session.access_token, body: { customer_id: session.user.customer_id, registration_no: `KDA ${index + 100}A`, year: 2020, mileage: 4294967295 }, expected: 201 })).data;
    customers.push({ ...session, vehicle });
  }
  const dateAt = (day, hour = 9) => {
    const value = new Date(); value.setUTCDate(value.getUTCDate() + day); value.setUTCHours(hour - 3, 0, 0, 0); return value.toISOString();
  };
  let job, jobTag, invoice, part, service;

  await t.test('real auth, rollback, customer ownership, search, pagination and retry replay', async () => {
    const me = await call('GET', '/auth/me', { token: customers[0].access_token });
    assert.equal(me.data.customer_id, customers[0].user.customer_id);
    assert.ok(!JSON.stringify(me.data).includes('password_hash'));
    const before = (await database.query('SELECT COUNT(*) AS total FROM customer')).rows[0].total;
    await call('POST', '/auth/register', { token: null, body: { name: 'Duplicate', email: 'customer0@example.com', password: loginPassword }, expected: 409 });
    assert.equal((await database.query('SELECT COUNT(*) AS total FROM customer')).rows[0].total, before);
    const profile = (await call('POST', '/customers', { body: { name: 'Literal %_! customer', phone: null }, expected: 201 })).data;
    await call('GET', `/customers/${profile.customer_id}`);
    await call('PATCH', `/customers/${profile.customer_id}`, { body: { phone: '0700000000' } });
    const search = await call('GET', '/customers?search=%25_%21&page_size=1');
    assert.equal(search.data.items.length, 1);
    assert.equal(search.data.items[0].customer_id, profile.customer_id);
    await call('GET', `/customers/${customers[1].user.customer_id}`, { token: customers[0].access_token, expected: 404 });
    await call('GET', '/customers', { token: staff[2].access_token, expected: 403 });
    await call('GET', '/users?role=MECHANIC');
    await call('GET', `/users/${staff[2].user.user_id}`);
    const key = randomUUID();
    const body = { customer_id: customers[0].user.customer_id, registration_no: 'retry 101', make: 'Toyota' };
    const repeats = await Promise.all([0,1].map(() => call('POST', '/vehicles', { token: customers[0].access_token, body, key, expected: null })));
    assert.deepEqual(repeats.map((r) => r.status), [201,201]);
    assert.deepEqual(repeats[0].data, repeats[1].data);
    assert.equal(repeats[0].location, repeats[1].location);
    await call('POST', '/vehicles', { token: customers[0].access_token, body: { ...body, model: 'Changed' }, key, expected: 409 });
    const replay = await call('POST', '/vehicles', { token: customers[0].access_token, body, key, expected: 201 });
    assert.deepEqual(replay.data, repeats[0].data);
    await call('GET', `/vehicles/${replay.data.vehicle_id}`, { token: customers[0].access_token });
    await call('PATCH', `/vehicles/${replay.data.vehicle_id}`, { token: customers[0].access_token, body: { year: null, mileage: null } });
    await call('GET', '/vehicles?page_size=1', { token: customers[0].access_token });
    await call('DELETE', `/vehicles/${replay.data.vehicle_id}`, { token: customers[0].access_token, expected: 204 });
  });

  await t.test('competing actors cannot double-book a bay or a vehicle; adjacency remains valid', async () => {
    const results = await Promise.all(customers.map((customer) => call('POST', '/bookings', {
      token: customer.access_token, body: { vehicle_id: customer.vehicle.vehicle_id, scheduled_at: dateAt(10), ends_at: dateAt(10, 10) }, expected: null,
    })));
    assert.deepEqual(results.map((r) => r.status).sort(), [201,409], JSON.stringify(results));
    const stored = (await database.query('SELECT * FROM booking')).rows;
    assert.equal(stored.length, 1);
    await call('POST', '/bookings', { body: { vehicle_id: customers[0].vehicle.vehicle_id, scheduled_at: dateAt(10, 10), ends_at: dateAt(10, 11) }, expected: 201 });
    await store.insert('BAY', { name: 'Bay Two', enabled: true }, 'bay_id');
    const sameVehicle = await Promise.all(staff.slice(0,2).map((account) => call('POST', '/bookings', { token: account.access_token, body: { vehicle_id: customers[0].vehicle.vehicle_id, scheduled_at: dateAt(11), ends_at: dateAt(11, 10) }, expected: null })));
    assert.deepEqual(sameVehicle.map((r) => r.status).sort(), [201,409], JSON.stringify(sameVehicle));
    const slots = await call('GET', `/bookings/availability?from=${dateAt(20)}&to=${dateAt(20,12)}&vehicle_id=${customers[0].vehicle.vehicle_id}`);
    assert.ok(slots.data.items.length > 0);
  });

  await t.test('catalogs, booking joins, status versions and job assignment execute against official tables', async () => {
    part = (await call('POST', '/parts', { body: { name: 'Oil filter', unit_price: '10.01' }, expected: 201 })).data;
    service = (await call('POST', '/service-tasks', { body: { name: 'Repair template', standard_hours: '1.25' }, expected: 201 })).data;
    await call('GET', `/parts/${part.part_id}`); await call('GET', '/parts?search=filter');
    await call('GET', `/service-tasks/${service.service_task_id}`); await call('GET', '/service-tasks');
    await call('PATCH', `/service-tasks/${service.service_task_id}`, { body: { standard_hours: '1.50' } });
    const spare = (await call('POST', '/parts', { body: { name: 'Unused part', unit_price: null }, expected: 201 })).data;
    await call('DELETE', `/parts/${spare.part_id}`, { expected: 204 });
    let booking = await call('POST', '/bookings', { body: { vehicle_id: customers[0].vehicle.vehicle_id, scheduled_at: dateAt(20), ends_at: dateAt(20,10) }, expected: 201 });
    await call('GET', `/bookings/${booking.data.booking_id}`);
    await call('PATCH', `/bookings/${booking.data.booking_id}`, { body: { scheduled_at: dateAt(20,10), ends_at: dateAt(20,11) }, etag: '"0"', expected: 412 });
    booking = await call('PATCH', `/bookings/${booking.data.booking_id}`, { body: { scheduled_at: dateAt(20,10), ends_at: dateAt(20,11) }, etag: booking.etag });
    booking = await call('PATCH', `/bookings/${booking.data.booking_id}/status`, { body: { status: 'CONFIRMED' }, etag: booking.etag });
    const listing = await call('GET', `/bookings?vehicle_id=${customers[0].vehicle.vehicle_id}&from=${dateAt(20,8)}&to=${dateAt(21,8)}`, { token: customers[0].access_token });
    assert.equal(listing.data.pagination.total, 1);
    const opened = await call('POST', '/job-cards', { body: { vehicle_id: customers[0].vehicle.vehicle_id, booking_id: booking.data.booking_id, mechanic_id: staff[2].user.user_id }, expected: 201 });
    job = opened.data; jobTag = opened.etag;
    await call('GET', `/job-cards/${job.job_card_id}`, { token: staff[2].access_token });
    const assigned = await call('PATCH', `/job-cards/${job.job_card_id}/assignment`, { body: { mechanic_id: staff[3].user.user_id }, etag: jobTag }); jobTag = assigned.etag;
    await call('GET', `/job-cards/${job.job_card_id}`, { token: staff[2].access_token, expected: 404 });
    const jobs = await call('GET', `/job-cards?mechanic_id=${staff[3].user.user_id}`, { token: staff[3].access_token });
    assert.equal(jobs.data.pagination.total, 1);
  });

  await t.test('task/part writes, immutable snapshots and concurrent invoice issuance', async () => {
    const path = `/job-cards/${job.job_card_id}`, token = staff[3].access_token;
    jobTag = (await call('PATCH', `${path}/status`, { token, body: { status: 'IN_PROGRESS' }, etag: jobTag })).etag;
    const task = await call('POST', `${path}/tasks`, { token, body: { name: service.name, standard_hours: '1.25' }, etag: jobTag, expected: 201 }); jobTag = task.etag;
    await call('GET', `${path}/tasks`, { token }); await call('GET', `${path}/tasks/${task.data.task_id}`, { token });
    jobTag = (await call('PATCH', `${path}/tasks/${task.data.task_id}`, { token, body: { standard_hours: '1.50' }, etag: jobTag })).etag;
    const extra = await call('POST', `${path}/tasks`, { token, body: { name: 'Unused task' }, etag: jobTag, expected: 201 }); jobTag = extra.etag;
    jobTag = (await call('DELETE', `${path}/tasks/${extra.data.task_id}`, { token, etag: jobTag, expected: 204 })).etag;
    jobTag = (await call('PUT', `${path}/parts/${part.part_id}`, { token, body: { quantity: 3 }, etag: jobTag })).etag;
    await call('GET', `${path}/parts`, { token });
    jobTag = (await call('DELETE', `${path}/parts/${part.part_id}`, { token, etag: jobTag, expected: 204 })).etag;
    jobTag = (await call('PUT', `${path}/parts/${part.part_id}`, { token, body: { quantity: 3 }, etag: jobTag })).etag;
    await call('PATCH', `/parts/${part.part_id}`, { body: { unit_price: '999.00' } });
    await call('DELETE', `/parts/${part.part_id}`, { expected: 409 });
    jobTag = (await call('PATCH', `${path}/status`, { token, body: { status: 'COMPLETED' }, etag: jobTag })).etag;
    const issued = await Promise.all(staff.slice(0,2).map((account) => call('POST', '/invoices', { token: account.access_token, body: { job_card_id: job.job_card_id }, expected: null })));
    assert.deepEqual(issued.map((r) => r.status).sort(), [201,409], JSON.stringify(issued));
    invoice = issued.find((r) => r.status === 201).data;
    assert.equal(invoice.total_amount, '1530.03');
    assert.equal(invoice.lines.find((line) => line.kind === 'PART').unit_price, '10.01');
    assert.ok(invoice.issued_at.endsWith('Z'));
    const list = await call('GET', '/invoices?payment_status=UNPAID', { token: customers[0].access_token });
    assert.ok(list.data.items.some((row) => row.invoice_id === invoice.invoice_id));
  });

  await t.test('concurrent payments cannot overpay; settled receipt, joins and closing use real balances', async () => {
    const paid = await Promise.all(staff.slice(0,2).map((account) => call('POST', `/invoices/${invoice.invoice_id}/payments`, { token: account.access_token, body: { amount: invoice.total_amount, method: 'CASH' }, expected: null })));
    assert.deepEqual(paid.map((r) => r.status).sort(), [201,409], JSON.stringify(paid));
    const payment = paid.find((r) => r.status === 201).data;
    await call('GET', `/payments/${payment.payment_id}`, { token: customers[0].access_token });
    const payments = await call('GET', `/invoices/${invoice.invoice_id}/payments`, { token: customers[0].access_token });
    assert.equal(payments.data.pagination.total, 1);
    const current = await call('GET', `/invoices/${invoice.invoice_id}`, { token: customers[0].access_token });
    assert.equal(current.data.amount_paid, '1530.03'); assert.equal(current.data.balance_due, '0.00');
    await call('GET', '/invoices?payment_status=PAID'); await call('GET', '/invoices?payment_status=PARTIALLY_PAID'); await call('GET', '/invoices');
    await call('PATCH', `/job-cards/${job.job_card_id}/status`, { body: { status: 'CLOSED' }, etag: jobTag });
    await call('DELETE', `/vehicles/${customers[0].vehicle.vehicle_id}`, { expected: 409 });
    await call('DELETE', `/service-tasks/${service.service_task_id}`, { expected: 204 });
  });

  await t.test('pending provider reservations protect balances and stored intent reads enforce ownership', async () => {
    const jobId = await store.insert('JOB_CARD', { vehicle_id: customers[1].vehicle.vehicle_id, booking_id: null, mechanic_id: staff[2].user.user_id, opened_at: new Date(), status: 'COMPLETED', version: 1 }, 'job_card_id');
    const id = await store.insert('INVOICE', { job_card_id: jobId, total_amount: '100.00', currency: 'KES', issued_at: new Date() }, 'invoice_id');
    await store.insert('INVOICE_LINE', { invoice_id: id, kind: 'LABOR', description: 'Seeded completed work', quantity: '1.00', unit_price: '100.00', line_total: '100.00' });
    const intentId = randomUUID();
    await store.insert('PAYMENT_INTENT', { payment_intent_id: intentId, invoice_id: id, amount: '90.00', method: 'CARD', status: 'PENDING', checkout_url: null, expires_at: new Date(Date.now() - 60000), payment_id: null, provider_id: 'private-provider-id' });
    const intent = await call('GET', `/payment-intents/${intentId}`, { token: customers[1].access_token });
    assert.equal(intent.data.amount, '90.00'); assert.ok(!JSON.stringify(intent.data).includes('private-provider-id'));
    await call('GET', `/payment-intents/${intentId}`, { token: customers[0].access_token, expected: 404 });
    await call('POST', `/invoices/${id}/payments`, { body: { amount: '10.01', method: 'CASH' }, expected: 409 });
    await call('POST', `/invoices/${id}/payments`, { body: { amount: '10.00', method: 'CASH' }, expected: 201 });
    await call('POST', `/invoices/${id}/payment-intents`, { token: customers[1].access_token, body: { amount: '1.00', method: 'CARD' }, expected: 503 });
    await store.update('PAYMENT_INTENT', { payment_intent_id: intentId }, { status: 'FAILED' });
    await call('POST', `/invoices/${id}/payments`, { body: { amount: '90.00', method: 'CARD', transaction_reference: 'verified-provider-transaction' }, expected: 201 });
  });

  await t.test('sessions revoke durably; database constraints and audit filters are real', async () => {
    await call('PATCH', `/users/${staff[2].user.user_id}`, { body: { name: 'Updated Mechanic' } });
    await call('POST', '/auth/logout', { token: customers[0].access_token, expected: 204 });
    await call('GET', '/auth/me', { token: customers[0].access_token, expected: 401 });
    await assert.rejects(database.query('INSERT INTO part (name, unit_price) VALUES (?, ?)', ['Negative price', '-1.00']), (error) => error.code === 'ER_CHECK_CONSTRAINT_VIOLATED');
    await assert.rejects(database.query('DELETE FROM vehicle WHERE vehicle_id = ?', [customers[0].vehicle.vehicle_id]), (error) => error.code === 'ER_ROW_IS_REFERENCED_2');
    const audit = await call('GET', `/audit-events?actor_user_id=${admin.user.user_id}&resource_type=Users&from=2000-01-01T00:00:00Z&to=2099-01-01T00:00:00Z`);
    assert.ok(audit.data.pagination.total > 0);
    assert.ok(exercised.has('createInvoice'));
    const missing = operations.filter((operation) => !exercised.has(operation.operationId)).map((operation) => operation.operationId);
    assert.deepEqual(missing, [], `Untested route handlers: ${missing.join(', ')}`);
    t.diagnostic(`All ${exercised.size} OpenAPI operation routes exercised against real MySQL.`);
  });
});
