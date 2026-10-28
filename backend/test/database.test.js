import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';

function fixture(driver, { failSql, rollbackFails = false, timeout = false } = {}) {
  const calls = [];
  let options;
  const run = async (target, sql, values) => {
    calls.push({ target, sql, values });
    if (sql === failSql || (rollbackFails && sql === 'ROLLBACK')) {
      const error = new Error('database failure');
      if (timeout && sql === failSql) error.code = 'PROTOCOL_SEQUENCE_TIMEOUT';
      throw error;
    }
    if (driver === 'postgres') return { rows: [{ amount: '12.30' }], rowCount: 1 };
    return sql.startsWith('INSERT')
      ? [{ affectedRows: 1, insertId: 42 }, []]
      : [[{ amount: '12.30' }], []];
  };
  const client = {
    query: (sql, values) => run('client', sql, values),
    execute: (spec, values) => run('client', spec.sql, values),
    release: (discard) => calls.push({ action: 'release', discard }),
    destroy: () => calls.push({ action: 'destroy' }),
  };
  const pool = {
    on() {}, query: (sql, values) => run('pool', sql, values),
    connect: async () => client, getConnection: async () => client,
    end: async () => calls.push({ action: 'close' }),
  };
  const database = createDatabase({
    driver, connectionString: `${driver === 'postgres' ? 'postgresql' : 'mysql'}://garage:p%40ss@localhost/garage`,
    max: 5, ssl: { rejectUnauthorized: true },
  }, console, { [driver]: (config) => { options = config; return pool; } });
  return { database, calls, options };
}

for (const driver of ['postgres', 'mysql']) {
  test(`${driver}: chooses native SQL, keeps values separate, and normalizes rows`, async () => {
    const { database, calls } = fixture(driver);
    const input = "x'; DROP TABLE customer; --";
    const sql = { postgres: 'SELECT amount FROM invoice WHERE invoice_id = $1', mysql: 'SELECT amount FROM invoice WHERE invoice_id = ?' };
    const result = await database.query(sql, [input]);
    assert.deepEqual(result, { rows: [{ amount: '12.30' }], rowCount: 1, insertId: null });
    assert.equal(calls[0].sql, sql[driver]);
    assert.deepEqual(calls[0].values, [input]);
    assert.ok(!calls[0].sql.includes(input));
    await database.close();
    assert.equal(calls.at(-1).action, 'close');
  });

  test(`${driver}: transaction commits on the same connection and releases it`, async () => {
    const { database, calls } = fixture(driver);
    const value = await database.transaction(async (tx) => {
      assert.equal(tx.driver, driver);
      await tx.query('SELECT 1');
      return 'saved';
    });
    assert.equal(value, 'saved');
    assert.deepEqual(calls.filter((c) => c.sql).map((c) => c.sql),
      [driver === 'postgres' ? 'BEGIN' : 'START TRANSACTION', 'SELECT 1', 'COMMIT']);
    assert.ok(calls.filter((c) => c.sql).every((c) => c.target === 'client'));
    assert.deepEqual(calls.at(-1), { action: 'release', discard: driver === 'postgres' ? false : undefined });
  });

  test(`${driver}: a failed transaction rolls back, releases, and preserves the error`, async () => {
    const { database, calls } = fixture(driver, { failSql: 'UPDATE broken' });
    await assert.rejects(database.transaction((tx) => tx.query('UPDATE broken')), /database failure/);
    assert.ok(calls.some((c) => c.sql === 'ROLLBACK'));
    assert.ok(!calls.some((c) => c.sql === 'COMMIT'));
    assert.equal(calls.at(-1).action, 'release');
  });

  test(`${driver}: failed rollback discards the connection`, async () => {
    const { database, calls } = fixture(driver, { rollbackFails: true });
    const original = new Error('original application failure');
    await assert.rejects(database.transaction(async () => { throw original; }), (error) => error === original);
    assert.deepEqual(calls.at(-1), driver === 'postgres' ? { action: 'release', discard: true } : { action: 'destroy' });
  });

  test(`${driver}: rejects a missing dialect statement`, async () => {
    const { database } = fixture(driver);
    await assert.rejects(database.query({ [driver === 'postgres' ? 'mysql' : 'postgres']: 'SELECT 1' }), /SQL statement/);
  });
}

test('MySQL preserves exact decimals and big integers and decodes URI credentials', async () => {
  const { database, options } = fixture('mysql');
  assert.equal(options.password, 'p@ss');
  assert.equal(options.decimalNumbers, false);
  assert.equal(options.bigNumberStrings, true);
  assert.equal(options.multipleStatements, false);
  assert.equal(options.waitForConnections, false);
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.verifyIdentity, true);
  assert.deepEqual(await database.query('INSERT INTO part (name) VALUES (?)', ['Oil']),
    { rows: [], rowCount: 1, insertId: 42 });
});

test('MySQL destroys a timed-out connection without returning it to the pool or retrying', async () => {
  const { database, calls } = fixture('mysql', { failSql: 'UPDATE slow', timeout: true });
  await assert.rejects(database.transaction((tx) => tx.query('UPDATE slow')), /database failure/);
  assert.equal(calls.filter((c) => c.sql === 'UPDATE slow').length, 1);
  assert.equal(calls.filter((c) => c.action === 'destroy').length, 1);
  assert.ok(!calls.some((c) => c.action === 'release'));
});
