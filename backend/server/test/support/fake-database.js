// In-memory driver double for HTTP orchestration tests, not an engine emulator.
// Real SQL execution/concurrency must be tested with the database team's schema.
export function fakeDatabase(driver = 'mysql') {
  let tables = {};
  const queries = [];
  const ids = { CUSTOMER: 'customer_id', USER: 'user_id', VEHICLE: 'vehicle_id', BOOKING: 'booking_id', JOB_CARD: 'job_card_id', TASK: 'task_id', PART: 'part_id', SERVICE_TASK: 'service_task_id', INVOICE: 'invoice_id', INVOICE_LINE: 'line_id', PAYMENT: 'payment_id', AUDIT_EVENT: 'audit_id' };
  const data = (table) => tables[table] ??= [];
  const database = {
    driver, queries,
    rows: data,
    seed(table, row) { data(table).push(structuredClone(row)); },
    check: async () => {},
    async query(sql, values = []) {
      queries.push({ sql, values });
      const plain = sql.replace(/["`]/g, '');
      const table = plain.match(/(?:FROM|INTO|UPDATE) ([A-Z_]+)/)?.[1];
      if (!table) throw new Error(`Unsupported test query: ${sql}`);
      if (plain.startsWith('INSERT')) {
        const columns = plain.match(/\(([^)]+)\) VALUES/)[1].split(',').map((c) => c.trim());
        const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
        const unique = { USER: ['email'], VEHICLE: ['registration_no'], INVOICE: ['job_card_id'], PAYMENT: ['transaction_reference'] }[table];
        if (unique && unique.some((key) => row[key] != null && data(table).some((entry) => entry[key] === row[key]))) {
          throw Object.assign(new Error('secret database constraint details'), { code: driver === 'postgres' ? '23505' : 'ER_DUP_ENTRY' });
        }
        const idColumn = ids[table];
        if (idColumn) row[idColumn] ??= Math.max(0, ...data(table).map((r) => Number(r[idColumn]))) + 1;
        data(table).push(structuredClone(row));
        return { rows: idColumn ? [{ [idColumn]: row[idColumn] }] : [], rowCount: 1, insertId: idColumn ? row[idColumn] : null };
      }
      let offset = 0;
      const changes = {};
      if (plain.startsWith('UPDATE')) {
        const sets = plain.split(' SET ')[1].split(' WHERE ')[0].split(',');
        for (const set of sets) changes[set.trim().split(' ')[0]] = values[offset++];
      }
      const clause = plain.split(' WHERE ')[1]?.split(/ ORDER BY | LIMIT | FOR UPDATE/)[0] ?? '';
      const tests = [];
      for (const expression of clause.split(' AND ')) {
        if (expression === '1 = 1' || !expression) continue;
        const match = expression.match(/^(\w+) (IS NULL|IN \(([^)]+)\)|= (?:\?|\$\d+|TRUE|'[^']*'))$/);
        if (!match) throw new Error(`Unsupported test condition: ${expression}`);
        const [, column, operation, list] = match;
        if (operation === 'IS NULL') tests.push((row) => row[column] == null);
        else if (list) {
          const count = list.split(',').length, expected = values.slice(offset, offset + count); offset += count;
          tests.push((row) => expected.includes(row[column]));
        } else {
          const expected = operation === '= TRUE' ? true : operation.includes("'") ? operation.slice(3, -1) : values[offset++];
          tests.push((row) => row[column] === expected || (expected === true && row[column] === 1));
        }
      }
      let selected = data(table).filter((row) => tests.every((predicate) => predicate(row)));
      if (plain.startsWith('UPDATE')) {
        for (const row of selected) Object.assign(row, changes);
        return { rows: [], rowCount: selected.length, insertId: null };
      }
      if (plain.startsWith('DELETE')) {
        tables[table] = data(table).filter((row) => !selected.includes(row));
        return { rows: [], rowCount: selected.length, insertId: null };
      }
      if (plain.startsWith('SELECT COUNT')) return { rows: [{ total: selected.length }], rowCount: 1 };
      const limit = plain.match(/LIMIT (\d+) OFFSET (\d+)/);
      if (limit) selected = selected.slice(Number(limit[2]), Number(limit[2]) + Number(limit[1]));
      return { rows: structuredClone(selected), rowCount: selected.length, insertId: null };
    },
    async transaction(work) {
      const before = structuredClone(tables);
      try { return await work(database); }
      catch (error) { tables = before; throw error; }
    },
  };
  return database;
}
