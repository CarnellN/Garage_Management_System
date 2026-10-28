import { postgresAdapter, mysqlAdapter } from './database/adapters.js';

export function createDatabase(config, logger = console, factories = {}) {
  const driver = config.driver ?? 'mysql';
  if (!['postgres', 'mysql'].includes(driver)) throw new Error('Unsupported database driver.');
  const adapter = driver === 'postgres'
    ? postgresAdapter(config, logger, factories.postgres)
    : mysqlAdapter(config, factories.mysql);
  return {
    driver,
    // Native placeholders, or { postgres: '... $1', mysql: '... ?' }. Never rewrite SQL by regex.
    query: (sql, values = []) => adapter.query(sql, values),
    async check() {
      await adapter.query('SELECT 1', []);
    },
    async transaction(work) {
      const client = await adapter.acquire();
      let discard = false;
      try {
        await client.begin();
        const result = await work({ driver, query: (sql, values = []) => client.query(sql, values) });
        await client.commit();
        return result;
      } catch (error) {
        try { await client.rollback(); } catch { discard = true; }
        throw error;
      } finally {
        client.release(discard);
      }
    },
    close: () => adapter.close(),
  };
}
