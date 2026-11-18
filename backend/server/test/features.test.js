// HTTP tests for two-factor authentication, password recovery, M-Pesa checkout, PDF reports and failure auditing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { createSecurity, hashPassword } from '../src/api/security.js';
import { createStore } from '../src/api/sql.js';
import { base32Encode, createCipher, currentStep, totpAt, verifyTotp } from '../src/api/mfa.js';
import { normalizeMsisdn, darajaTimestamp } from '../src/services/mpesa.js';
import { renderReport } from '../src/reports/pdf.js';
import { fakeDatabase } from './support/fake-database.js';

const auth = { secret: 'test-only-random-like-secret-of-at-least-32-bytes' };
const logger = { info() {}, error() {} };
const PASSWORD = 'Correct horse battery 1';
const CALLBACK_TOKEN = 'callback-token-for-tests-only-0123456789';

async function setup(t, { mpesa } = {}) {
  const database = fakeDatabase();
  const outbox = [];
  const mailer = { configured: true, async send(message) { outbox.push(message); } };
  const app = createApp({
    database, auth, logger, mailer, mpesa, appBaseUrl: 'http://localhost:5173',
    company: { name: 'Test Garage Ltd', phone: '+254700000000' },
    workflows: { schedule: { open: 480, close: 1020, days: [1, 2, 3, 4, 5, 6] }, laborRate: '1000.00' },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = 'GET', token, body, headers = {} } = {}) => {
    const response = await fetch(`${base}${path.startsWith('/api/') ? '' : '/api/v1'}${path}`, {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const type = response.headers.get('content-type') ?? '';
    const result = response.status === 204 ? null : type.includes('application/pdf') ? Buffer.from(await response.arrayBuffer()) : await response.json();
    return { status: response.status, body: result, headers: response.headers };
  };
  const account = async (role = 'CUSTOMER', customer_id = 1) => {
    const user = { user_id: database.rows('USER').length + 1, name: `${role} User`, role, email: `${role.toLowerCase()}${database.rows('USER').length}@example.com`, active: true, customer_id: role === 'CUSTOMER' ? customer_id : null, password_hash: await hashPassword(PASSWORD) };
    database.seed('USER', user);
    const session = await createSecurity(database, auth).session(createStore(database), user);
    return { user, token: session.access_token };
  };
  return { database, request, account, outbox };
}

function seedInvoice(database, { total = '1000.00', phone = '0712345678' } = {}) {
  database.seed('CUSTOMER', { customer_id: 1, name: 'Owner', phone, email: 'owner@example.com' });
  database.seed('VEHICLE', { vehicle_id: 1, customer_id: 1, registration_no: 'KDA 001A', make: 'Toyota', model: 'Vitz', year: 2015, mileage: null });
  database.seed('JOB_CARD', { job_card_id: 1, vehicle_id: 1, booking_id: null, mechanic_id: 99, opened_at: new Date(), status: 'COMPLETED', version: 1 });
  database.seed('INVOICE', { invoice_id: 1, job_card_id: 1, total_amount: total, currency: 'KES', issued_at: new Date() });
  database.seed('INVOICE_LINE', { invoice_line_id: 1, invoice_id: 1, kind: 'LABOR', description: 'Service', quantity: '1.00', unit_price: total, line_total: total });
}

test('TOTP matches the RFC 6238 SHA-1 test vector and rejects replays', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(totpAt(secret, Math.floor(59 / 30)), '287082');
  assert.equal(totpAt(secret, Math.floor(1111111109 / 30)), '081804');
  const now = Date.now();
  const code = totpAt(secret, currentStep(now));
  const step = verifyTotp(secret, code, { now });
  assert.equal(step, currentStep(now));
  assert.equal(verifyTotp(secret, code, { now, lastUsedStep: step }), null);
  assert.equal(verifyTotp(secret, '12345', { now }), null);
});

test('field encryption round-trips and detects tampering', () => {
  const cipher = createCipher({ jwtSecret: auth.secret });
  const stored = cipher.encrypt('JBSWY3DPEHPK3PXP');
  assert.notEqual(stored, 'JBSWY3DPEHPK3PXP');
  assert.equal(cipher.decrypt(stored), 'JBSWY3DPEHPK3PXP');
  const parts = stored.split('.');
  parts[3] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => cipher.decrypt(parts.join('.')));
});

test('two-factor enrolment, login challenge, replay protection and disable', async (t) => {
  const { database, request, account } = await setup(t);
  const { user, token } = await account('RECEPTIONIST');
  assert.deepEqual((await request('/auth/mfa', { token })).body, { enabled: false });
  const setupResult = await request('/auth/mfa/setup', { method: 'POST', token });
  assert.equal(setupResult.status, 201);
  assert.match(setupResult.body.otpauth_uri, /^otpauth:\/\/totp\/Test%20Garage%20Ltd/);
  const stored = database.rows('USER_MFA')[0];
  assert.ok(!stored.secret_encrypted.includes(setupResult.body.secret), 'secret must be encrypted at rest');
  const secret = setupResult.body.secret;
  assert.equal((await request('/auth/mfa/enable', { method: 'POST', token, body: { code: '000000' === totpAt(secret, currentStep()) ? '111111' : '000000' } })).status, 422);
  assert.equal((await request('/auth/mfa/enable', { method: 'POST', token, body: { code: totpAt(secret, currentStep()) } })).status, 200);
  // A code already used during enrolment cannot be used again to log in.
  const replay = await request('/auth/login', { method: 'POST', body: { email: user.email, password: PASSWORD, otp: totpAt(secret, currentStep()) } });
  assert.equal(replay.status, 401);
  assert.equal(replay.body.code, 'INVALID_OTP');
  const challenge = await request('/auth/login', { method: 'POST', body: { email: user.email, password: PASSWORD } });
  assert.equal(challenge.status, 401);
  assert.equal(challenge.body.code, 'MFA_REQUIRED');
  database.rows('USER_MFA')[0].last_used_step = currentStep() - 2;
  const login = await request('/auth/login', { method: 'POST', body: { email: user.email, password: PASSWORD, otp: totpAt(secret, currentStep()) } });
  assert.equal(login.status, 200);
  database.rows('USER_MFA')[0].last_used_step = currentStep() - 2;
  assert.equal((await request('/auth/mfa/disable', { method: 'POST', token: login.body.access_token, body: { password: 'wrong password', code: totpAt(secret, currentStep()) } })).status, 401);
  assert.equal((await request('/auth/mfa/disable', { method: 'POST', token: login.body.access_token, body: { password: PASSWORD, code: totpAt(secret, currentStep()) } })).status, 200);
  assert.equal(database.rows('USER_MFA').length, 0);
});

test('admins can remove a lost two-factor device; other roles cannot', async (t) => {
  const { database, request, account } = await setup(t);
  const admin = await account('ADMIN');
  const staff = await account('MECHANIC');
  await request('/auth/mfa/setup', { method: 'POST', token: staff.token });
  assert.equal((await request(`/users/${admin.user.user_id}/mfa/reset`, { method: 'POST', token: staff.token })).status, 403);
  assert.equal((await request(`/users/${staff.user.user_id}/mfa/reset`, { method: 'POST', token: admin.token })).status, 200);
  assert.equal(database.rows('USER_MFA').length, 0);
  assert.equal((await request('/auth/me', { token: staff.token })).status, 401, 'sessions are revoked');
});

test('forgot password emails a single-use token; reset changes the password and revokes sessions', async (t) => {
  const { database, request, account, outbox } = await setup(t);
  const { user, token } = await account('CUSTOMER');
  const unknown = await request('/auth/password/forgot', { method: 'POST', body: { email: 'nobody@example.com' } });
  assert.equal(unknown.status, 202);
  assert.equal(outbox.length, 0);
  const known = await request('/auth/password/forgot', { method: 'POST', body: { email: user.email.toUpperCase() } });
  assert.equal(known.status, 202);
  assert.deepEqual(known.body, unknown.body, 'responses do not reveal whether the account exists');
  assert.equal(outbox.length, 1);
  const resetToken = outbox[0].text.match(/token=([A-Za-z0-9_-]+)/)[1];
  assert.ok(!database.rows('PASSWORD_RESET').some((row) => row.token_hash === resetToken), 'only a hash is stored');
  assert.equal((await request('/auth/password/reset', { method: 'POST', body: { token: 'x'.repeat(43), password: 'Another long password 9' } })).status, 400);
  assert.equal((await request('/auth/password/reset', { method: 'POST', body: { token: resetToken, password: 'Another long password 9' } })).status, 204);
  assert.equal((await request('/auth/password/reset', { method: 'POST', body: { token: resetToken, password: 'Yet another password 10' } })).status, 400, 'token is single-use');
  assert.equal((await request('/auth/me', { token })).status, 401, 'existing sessions end');
  assert.equal((await request('/auth/login', { method: 'POST', body: { email: user.email, password: PASSWORD } })).status, 401);
  assert.equal((await request('/auth/login', { method: 'POST', body: { email: user.email, password: 'Another long password 9' } })).status, 200);
  const audit = database.rows('AUDIT_EVENT').filter((row) => row.action === 'resetPassword');
  assert.deepEqual(audit.map((row) => row.outcome).sort(), ['FAILURE', 'FAILURE', 'SUCCESS']);
});

test('expired reset tokens are rejected and a new request invalidates the previous link', async (t) => {
  const { database, request, account, outbox } = await setup(t);
  const { user } = await account('CUSTOMER');
  await request('/auth/password/forgot', { method: 'POST', body: { email: user.email } });
  await request('/auth/password/forgot', { method: 'POST', body: { email: user.email } });
  const [first, second] = outbox.map((mail) => mail.text.match(/token=([A-Za-z0-9_-]+)/)[1]);
  assert.equal((await request('/auth/password/reset', { method: 'POST', body: { token: first, password: 'Another long password 9' } })).status, 400);
  database.rows('PASSWORD_RESET').at(-1).expires_at = new Date(Date.now() - 1000);
  assert.equal((await request('/auth/password/reset', { method: 'POST', body: { token: second, password: 'Another long password 9' } })).status, 400);
});

test('change password requires the current password and ends all sessions', async (t) => {
  const { request, account } = await setup(t);
  const { token } = await account('MECHANIC');
  assert.equal((await request('/auth/password/change', { method: 'POST', token, body: { current_password: 'wrong', new_password: 'A brand new password 1' } })).status, 401);
  assert.equal((await request('/auth/password/change', { method: 'POST', token, body: { current_password: PASSWORD, new_password: 'short' } })).status, 422);
  assert.equal((await request('/auth/password/change', { method: 'POST', token, body: { current_password: PASSWORD, new_password: 'A brand new password 1' } })).status, 204);
  assert.equal((await request('/auth/me', { token })).status, 401);
});

test('M-Pesa helpers normalise Kenyan numbers and Nairobi timestamps', () => {
  assert.equal(normalizeMsisdn('0712 345 678'), '254712345678');
  assert.equal(normalizeMsisdn('+254112345678'), '254112345678');
  assert.equal(normalizeMsisdn('0812345678'), null);
  assert.equal(darajaTimestamp(new Date('2026-01-01T21:30:05Z')), '20260102003005');
});

function fakeMpesa(answers = {}) {
  const calls = [];
  return {
    configured: true, callbackToken: CALLBACK_TOKEN, calls,
    async stkPush(input) { calls.push(['push', input]); if (answers.pushFails) throw new Error('rejected'); return { checkoutRequestId: 'ws_CO_TEST_1' }; },
    async query(id) { calls.push(['query', id]); return answers.query ?? { state: 'SUCCEEDED', resultCode: '0' }; },
  };
}

test('M-Pesa checkout reserves the balance, prompts the phone and settles only after a verified callback', async (t) => {
  const mpesa = fakeMpesa();
  const { database, request, account } = await setup(t, { mpesa });
  seedInvoice(database);
  const customer = await account('CUSTOMER', 1);
  const headers = { 'Idempotency-Key': 'mpesa-checkout-0001' };
  assert.equal((await request('/invoices/1/payment-intents', { method: 'POST', token: customer.token, headers, body: { amount: '1000.00', method: 'CARD' } })).status, 422);
  assert.equal((await request('/invoices/1/payment-intents', { method: 'POST', token: customer.token, headers: { 'Idempotency-Key': 'mpesa-checkout-0002' }, body: { amount: '10.50', method: 'MOBILE_MONEY' } })).status, 422);
  assert.equal((await request('/invoices/1/payment-intents', { method: 'POST', token: customer.token, headers: { 'Idempotency-Key': 'mpesa-checkout-0003' }, body: { amount: '1001.00', method: 'MOBILE_MONEY' } })).status, 409);
  const created = await request('/invoices/1/payment-intents', { method: 'POST', token: customer.token, headers: { 'Idempotency-Key': 'mpesa-checkout-0004' }, body: { amount: '600.00', method: 'MOBILE_MONEY' } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.status, 'PENDING');
  assert.deepEqual(mpesa.calls[0], ['push', { amount: 600, phone: '254712345678', reference: 'INV1', description: 'Invoice 1' }]);
  assert.equal(database.rows('PAYMENT_INTENT')[0].provider_id, 'ws_CO_TEST_1');
  // The pending reservation blocks a second checkout for more than the remaining balance.
  assert.equal((await request('/invoices/1/payment-intents', { method: 'POST', token: customer.token, headers: { 'Idempotency-Key': 'mpesa-checkout-0005' }, body: { amount: '500.00', method: 'MOBILE_MONEY' } })).status, 409);
  const callback = { Body: { stkCallback: { MerchantRequestID: 'm1', CheckoutRequestID: 'ws_CO_TEST_1', ResultCode: 0, ResultDesc: 'ok', CallbackMetadata: { Item: [{ Name: 'Amount', Value: 600 }, { Name: 'MpesaReceiptNumber', Value: 'TKA1B2C3D4' }, { Name: 'PhoneNumber', Value: 254712345678 }] } } } };
  assert.equal((await request('/payments/mpesa/callback/wrong-token-wrong-token-wrong-token-00', { method: 'POST', body: callback })).status, 404);
  assert.equal(database.rows('PAYMENT').length, 0);
  const ack = await request(`/payments/mpesa/callback/${CALLBACK_TOKEN}`, { method: 'POST', body: callback });
  assert.deepEqual(ack.body, { ResultCode: 0, ResultDesc: 'Accepted' });
  assert.deepEqual(mpesa.calls.at(-1), ['query', 'ws_CO_TEST_1'], 'callback is verified with Daraja');
  assert.equal(database.rows('PAYMENT').length, 1);
  assert.equal(database.rows('PAYMENT')[0].transaction_reference, 'TKA1B2C3D4');
  assert.equal(database.rows('PAYMENT_INTENT')[0].status, 'SUCCEEDED');
  // Duplicate callbacks settle nothing twice.
  await request(`/payments/mpesa/callback/${CALLBACK_TOKEN}`, { method: 'POST', body: callback });
  assert.equal(database.rows('PAYMENT').length, 1);
  const invoice = await request('/invoices/1', { token: customer.token });
  assert.equal(invoice.body.balance_due, '400.00');
});

test('M-Pesa refresh settles failures and push errors release the reservation', async (t) => {
  const mpesa = fakeMpesa({ query: { state: 'FAILED', resultCode: '1032' } });
  const { database, request, account } = await setup(t, { mpesa });
  seedInvoice(database);
  const customer = await account('CUSTOMER', 1);
  const created = await request('/invoices/1/payment-intents', { method: 'POST', token: customer.token, headers: { 'Idempotency-Key': 'mpesa-checkout-0010' }, body: { amount: '1000.00', method: 'MOBILE_MONEY', phone: '+254722000000' } });
  assert.equal(created.status, 201);
  const refreshed = await request(`/payment-intents/${created.body.payment_intent_id}/refresh`, { method: 'POST', token: customer.token });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.status, 'FAILED');
  assert.equal(database.rows('PAYMENT').length, 0);
  mpesa.calls.length = 0;
  const failing = fakeMpesa({ pushFails: true });
  const second = await setup(t, { mpesa: failing });
  seedInvoice(second.database);
  const owner = await second.account('CUSTOMER', 1);
  const result = await second.request('/invoices/1/payment-intents', { method: 'POST', token: owner.token, headers: { 'Idempotency-Key': 'mpesa-checkout-0011' }, body: { amount: '1000.00', method: 'MOBILE_MONEY' } });
  assert.equal(result.status, 502);
  assert.equal(second.database.rows('PAYMENT_INTENT')[0].status, 'FAILED');
});

test('reports render branded PDFs; roles and scopes are enforced', async (t) => {
  const pdf = await renderReport({
    company: { name: 'Test Garage Ltd', initials: 'TGL' }, title: 'Revenue Report', filters: ['Period: test'],
    columns: [{ header: 'Name', key: 'name' }, { header: 'Amount', key: 'amount', align: 'right' }],
    rows: Array.from({ length: 120 }, (_, index) => ({ name: `Row ${index}`, amount: '1.00' })), totals: [['Total', 'KES 120.00', true]], generatedBy: 'Tester',
  });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 3000);
  const { database, request, account } = await setup(t);
  seedInvoice(database);
  const customer = await account('CUSTOMER', 1);
  const other = await account('CUSTOMER', 2);
  const mechanic = await account('MECHANIC');
  assert.equal((await request('/reports/revenue', { token: customer.token })).status, 403);
  assert.equal((await request('/reports/audit', { token: mechanic.token })).status, 403);
  assert.equal((await request('/reports/bookings?from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z', { token: (await account('ADMIN')).token })).status, 422);
  const invoicePdf = await request('/invoices/1/pdf', { token: customer.token });
  assert.equal(invoicePdf.status, 200);
  assert.equal(invoicePdf.headers.get('content-type'), 'application/pdf');
  assert.match(invoicePdf.headers.get('content-disposition'), /invoice-1-/);
  assert.equal(invoicePdf.body.subarray(0, 5).toString(), '%PDF-');
  const json = await request('/invoices/1/pdf?format=json', { token: customer.token });
  assert.equal(json.body.invoice.total_amount, '1000.00');
  assert.equal((await request('/invoices/1/pdf', { token: other.token })).status, 404);
  assert.ok(database.rows('AUDIT_EVENT').some((row) => row.action === 'getInvoicePdf' && row.resource_type === 'Reports'));
});

test('failed changes are written to the audit trail with the acting user', async (t) => {
  const { database, request, account } = await setup(t);
  const admin = await account('ADMIN');
  const result = await request('/parts/999', { method: 'PATCH', token: admin.token, body: { name: 'Nothing' } });
  assert.equal(result.status, 404);
  const event = database.rows('AUDIT_EVENT').find((row) => row.action === 'updatePart');
  assert.equal(event.outcome, 'FAILURE');
  assert.equal(event.actor_user_id, admin.user.user_id);
});
