import test from 'node:test';
import assert from 'node:assert/strict';
import { schema, validateIdentifiers } from './support/schema.js';
import { createStore } from '../src/api/sql.js';

test('official reference has the sixteen supplied tables and current column names', () => {
  assert.equal(schema.size, 16);
  assert.ok(schema.has('job_part'));
  assert.ok(!schema.has('job_parts'));
  assert.ok(!schema.has('auth_session'));
  assert.ok(schema.get('invoice_line').has('invoice_line_id'));
  assert.ok(schema.get('idempotency_key').has('http_method'));
  assert.ok(schema.get('idempotency_key').has('request_fingerprint'));
  assert.ok(schema.get('idempotency_key').has('response_status'));
  assert.ok(schema.get('idempotency_key').has('response_body'));
});

for (const driver of ['mysql', 'postgres']) {
  test(`${driver}: generated queries use lowercase physical tables and official part/line identifiers`, async () => {
    const queries = [];
    const store = createStore({ driver, async query(sql, values) {
      validateIdentifiers(sql); queries.push({ sql, values });
      return { rows: [], rowCount: 0 };
    } });
    await store.find('JOB_PART', { job_card_id: 7, part_id: 2 });
    await store.find('INVOICE_LINE', { invoice_line_id: 8 });
    await store.find('IDEMPOTENCY_KEY', { user_id: 1, http_method: 'POST', path: '/api/v1/vehicles', key: 'some-retry-key-001' });
    assert.match(queries[0].sql, /["`]job_part["`]/);
    assert.match(queries[1].sql, /["`]invoice_line_id["`]/);
    assert.throws(() => validateIdentifiers('SELECT * FROM `JOB_PARTS`'), /official schema/);
    assert.throws(() => validateIdentifiers('SELECT `response_json` FROM `idempotency_key`'), /unknown identifier/);
  });
}
