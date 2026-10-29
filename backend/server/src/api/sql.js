// Only identifiers supplied by server code go through ident(). Values always bind separately.
export function createStore(db) {
  const quote = db.driver === 'postgres' ? '"' : '`';
  const ident = (name) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Invalid SQL identifier.');
    // Logical table constants use uppercase; the official physical names are lowercase.
    return `${quote}${name.toLowerCase()}${quote}`;
  };
  const build = () => {
    const values = [];
    return {
      values,
      bind(value) { values.push(value); return db.driver === 'postgres' ? `$${values.length}` : '?'; },
    };
  };
  const where = (filters, b) => Object.entries(filters).map(([key, value]) =>
    value === null ? `${ident(key)} IS NULL` : Array.isArray(value)
      ? `${ident(key)} IN (${value.map((entry) => b.bind(entry)).join(', ')})`
      : `${ident(key)} = ${b.bind(value)}`).join(' AND ') || '1 = 1';
  return {
    db, ident, build, where,
    async find(table, filters, { lock = false } = {}) {
      const b = build();
      const result = await db.query(`SELECT * FROM ${ident(table)} WHERE ${where(filters, b)}${lock ? ' FOR UPDATE' : ''}`, b.values);
      return result.rows[0] ?? null;
    },
    async insert(table, data, idColumn) {
      const b = build();
      const keys = Object.keys(data);
      const sql = `INSERT INTO ${ident(table)} (${keys.map(ident).join(', ')}) VALUES (${keys.map((key) => b.bind(data[key])).join(', ')})`;
      const result = await db.query(sql + (db.driver === 'postgres' && idColumn ? ` RETURNING ${ident(idColumn)}` : ''), b.values);
      return idColumn ? Number(db.driver === 'postgres' ? result.rows[0][idColumn] : result.insertId) : null;
    },
    async update(table, filters, data) {
      const b = build();
      const sets = Object.entries(data).map(([key, value]) => `${ident(key)} = ${b.bind(value)}`).join(', ');
      return db.query(`UPDATE ${ident(table)} SET ${sets} WHERE ${where(filters, b)}`, b.values);
    },
    async remove(table, filters) {
      const b = build();
      return db.query(`DELETE FROM ${ident(table)} WHERE ${where(filters, b)}`, b.values);
    },
    async list(table, filters, { page = 1, page_size = 20, search, searchFields = [] } = {}) {
      const b = build();
      let clause = where(filters, b);
      if (search && searchFields.length) {
        // Search is a literal substring: escape LIKE metacharacters with an explicit escape character.
        const term = `%${search.toLowerCase().replace(/[!%_]/g, '!$&')}%`;
        clause += ` AND (${searchFields.map((field) => `LOWER(${ident(field)}) LIKE ${b.bind(term)} ESCAPE '!'`).join(' OR ')})`;
      }
      const total = await db.query(`SELECT COUNT(*) AS total FROM ${ident(table)} WHERE ${clause}`, b.values);
      const firstColumn = { CUSTOMER: 'customer_id', VEHICLE: 'vehicle_id', PART: 'part_id', SERVICE_TASK: 'service_task_id', USER: 'user_id', TASK: 'task_id', JOB_PART: 'part_id', AUDIT_EVENT: 'audit_id' }[table];
      const result = await db.query(`SELECT * FROM ${ident(table)} WHERE ${clause} ORDER BY ${ident(firstColumn)} ASC LIMIT ${page_size} OFFSET ${(page - 1) * page_size}`, b.values);
      return { items: result.rows, pagination: { page, page_size, total: Number(total.rows[0].total) } };
    },
  };
}
