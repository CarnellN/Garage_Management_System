import pg from 'pg';
import mysql from 'mysql2/promise';

function statement(sql, driver) {
  const text = typeof sql === 'string' ? sql : sql?.[driver];
  if (typeof text !== 'string' || !text.trim()) throw new Error(`A SQL statement for ${driver} is required.`);
  return text;
}

export function postgresAdapter(config, logger, createPool = (options) => new pg.Pool(options)) {
  const pool = createPool({
    connectionString: config.connectionString, max: config.max, ssl: config.ssl,
    application_name: 'garage-management-api', connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000, statement_timeout: 5000, query_timeout: 6000,
    idle_in_transaction_session_timeout: 10000, allowExitOnIdle: true,
  });
  pool.on('error', () => logger.error({ event: 'database_pool_error' }));
  const query = async (target, sql, values) => {
    const result = await target.query(statement(sql, 'postgres'), values);
    return { rows: result.rows, rowCount: result.rowCount, insertId: null };
  };
  return {
    query: (sql, values) => query(pool, sql, values),
    async acquire() {
      const client = await pool.connect();
      return {
        query: (sql, values) => query(client, sql, values),
        begin: () => client.query('BEGIN'), commit: () => client.query('COMMIT'),
        rollback: () => client.query('ROLLBACK'), release: (discard) => client.release(discard),
      };
    },
    close: () => pool.end(),
  };
}

export function mysqlAdapter(config, createPool = (options) => mysql.createPool(options)) {
  const url = new URL(config.connectionString);
  const pool = createPool({
    host: url.hostname === '[::1]' ? '::1' : url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    ssl: config.ssl ? { ...config.ssl, verifyIdentity: true } : undefined,
    connectionLimit: config.max,
    // Fail at capacity instead of queuing requests indefinitely.
    waitForConnections: false, connectTimeout: 5000, idleTimeout: 30000,
    enableKeepAlive: true, multipleStatements: false, charset: 'utf8mb4', timezone: 'Z',
    dateStrings: true, decimalNumbers: false, supportBigNumbers: true, bigNumberStrings: true,
  });
  async function acquire() {
    const connection = await pool.getConnection();
    let destroyed = false;
    const execute = async (text, values = []) => {
      try {
        return await connection.execute({ sql: text, timeout: 6000 }, values);
      } catch (error) {
        // Timed-out writes have an unknown outcome; never reuse this connection or retry.
        if (error.code === 'PROTOCOL_SEQUENCE_TIMEOUT' || error.fatal) {
          destroyed = true;
          connection.destroy();
        }
        throw error;
      }
    };
    return {
      async query(sql, values) {
        const [result] = await execute(statement(sql, 'mysql'), values);
        return Array.isArray(result)
          ? { rows: result, rowCount: result.length, insertId: null }
          : { rows: [], rowCount: result.affectedRows, insertId: result.insertId || null };
      },
      begin: () => execute('START TRANSACTION'), commit: () => execute('COMMIT'),
      rollback: () => destroyed ? Promise.reject(new Error('Connection discarded.')) : execute('ROLLBACK'),
      release(discard) {
        if (destroyed) return;
        if (discard) connection.destroy();
        else connection.release();
      },
    };
  }
  return {
    acquire,
    async query(sql, values) {
      const connection = await acquire();
      try { return await connection.query(sql, values); }
      finally { connection.release(false); }
    },
    close: () => pool.end(),
  };
}
