import pg from 'pg';

export function createDatabase(config, logger = console) {
  const pool = new pg.Pool({
    ...config,
    application_name: 'garage-management-api',
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 5000,
    query_timeout: 6000,
    idle_in_transaction_session_timeout: 10000,
    allowExitOnIdle: true,
  });
  // Idle connections can fail without an active query; handle rather than crash.
  pool.on('error', () => logger.error({ event: 'database_pool_error' }));
  return {
    // Always pass SQL values separately: query('... WHERE id = $1', [id]).
    query: (text, values = []) => pool.query(text, values),
    async check() {
      await pool.query('SELECT 1');
    },
    async transaction(work) {
      const client = await pool.connect();
      let discard = false;
      try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { discard = true; }
        throw error;
      } finally {
        client.release(discard);
      }
    },
    close: () => pool.end(),
  };
}
