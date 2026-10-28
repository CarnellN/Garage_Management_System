# Garage Management API

Express 5 server foundation for [the API contract](../docs/openapi.yaml), using Node.js 22+. Uses MySQL 8.0.16+ through `mysql2` by default, with Supabase/PostgreSQL through `pg` available as a backup deployment option.

Implemented: verified TLS database pool, parameterized-query/transaction helpers, environment validation, security headers, exact-origin CORS, correlation IDs, sanitized JSON errors, health probes, startup connectivity checks, and graceful shutdown. Authentication, database migrations, and the business endpoints in the contract are the next implementation stage. Unimplemented endpoints return 404; no customer or financial data is exposed yet.

## Local setup

From the repository root in PowerShell:

```powershell
cd backend
npm.cmd install
Copy-Item .env.example .env
# Edit .env locally with your database connection information.
npm.cmd run db:check
npm.cmd run dev
```

Use `npm ci` for subsequent clean installs with the committed lockfile. On shells without PowerShell execution-policy restrictions, `npm` works in place of `npm.cmd`. `npm start` runs without file watching; `npm test` runs HTTP, configuration and adapter lifecycle tests with mocked driver pools. These tests do not connect to a real database.

## Choose the database

`DB_CLIENT` defaults to `mysql`. Set `DB_CLIENT=postgres` explicitly to use the Supabase/PostgreSQL backup option; the `DATABASE_URL` scheme must match. Restart the server after changing providers. This selects one database per running server; switching is manual and does not migrate or replicate data or provide automatic failover.

For local MySQL, create `garage_management_db` and a password-protected application user, then configure:

```dotenv
DB_CLIENT=mysql
DATABASE_URL=mysql://garage_user:ENCODED_PASSWORD@localhost:3306/garage_management_db
DB_SSL=false
```

For hosted MySQL, use its actual host/port, `DB_SSL=true`, and `DB_SSL_CA_FILE` if the provider requires a CA certificate. Certificate verification remains enabled. MySQL URIs must not contain query options; driver options are configured in code. `DB_SSL=false` is only allowed for localhost outside production. Use MySQL 8.0.16+ with InnoDB for enforced CHECK constraints, foreign keys and transactions. Run `npm.cmd run db:check` to test the selected connection. Supabase itself provides PostgreSQL; MySQL is an alternative deployment provider.

## Supabase backup connection

To switch to Supabase, set `DB_CLIENT=postgres` and `DB_SSL=true`. In the Supabase dashboard, open **Connect**, select **Session pooler**, and copy the PostgreSQL URI into `DATABASE_URL` in `backend/.env`. Copy your project's actual username and host. Replace the password placeholder with the URL-encoded database password; keep secrets out of the frontend, Git, screenshots and chat. This server connects over PostgreSQL and does not require an anon or service-role API key.

The session pooler is useful for a persistent Express process, especially on IPv4 networks. A direct connection also works if the deployment supports the network requirements. The Supabase physical database is generally `postgres`; `garage_management_db` remains the project's logical database name. Do not change the URI database name unless you have actually created that database.

TLS certificate verification is enabled. If your endpoint requires Supabase's database CA, download the certificate from the project settings, save it to `backend/certs/supabase-ca.crt`, and set `DB_SSL_CA_FILE=./certs/supabase-ca.crt`. Relative paths resolve from the backend working directory. Do not add SSL query options such as `sslmode` to the URI: configure TLS only through `DB_SSL`/`DB_SSL_CA_FILE` so URI parsing cannot weaken verification. `DB_SSL=false` is accepted only for localhost outside production.

`DB_POOL_MAX` defaults to 5 per server process; budget the sum across all replicas against your project limits. Use a dedicated least-privilege database login when provisioning the schema. A privileged database connection does not enforce end-user ownership automatically: future business routes must authenticate users and enforce the contract's role and ownership checks in transactions. Do not treat CORS as authorization.

Reference: [Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [node-postgres TLS configuration](https://node-postgres.com/features/ssl).

## Runtime

The default listener is `http://127.0.0.1:8000`; business routes will live under `/api/v1`. Set `HOST=0.0.0.0` for containers and deploy behind HTTPS. Set an explicit `CORS_ORIGINS` comma-separated list in production. Proxy trust is disabled until the deployment's exact proxy topology is configured.

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Process liveness, no database query |
| `GET /health/ready` | Runs `SELECT 1`; returns 503 if the database is unavailable |

Health probes are infrastructure endpoints outside the business OpenAPI contract. They do not check that application tables have been migrated. The server verifies database connectivity before listening. No migrations or remote writes run automatically. SIGINT/SIGTERM stop accepting traffic, drain active requests, and close the database pool; shutdown is bounded to 10 seconds.

## Database interface and SQL portability

Both adapters expose `driver`, `query(sql, values)`, `transaction(work)`, `check()` and `close()`. Queries return `{ rows, rowCount, insertId }`; `insertId` is available for MySQL inserts, while PostgreSQL inserts should use `RETURNING` and read `rows`. For SELECT, `rowCount` is the number of returned rows. For MySQL UPDATE, the driver reports matched rows by default; do not assume it counts changed values. Keep database-specific behavior inside repositories, away from HTTP handlers.

Supply values separately and use native placeholders, or supply both SQL dialects:

```js
const result = await database.query({
  postgres: 'SELECT * FROM customer WHERE customer_id = $1',
  mysql: 'SELECT * FROM customer WHERE customer_id = ?',
}, [customerId]);
```

The adapter selects SQL without rewriting it. MySQL uses prepared execution and disables multiple statements. Exact DECIMAL and large integer values remain strings. MySQL date/time columns return strings; repositories must write UTC and serialize date/time fields to RFC 3339 for the API. Avoid database-generated local timestamps unless the session timezone is explicitly UTC. MySQL dates, boolean fields and insert results need explicit repository mapping to the API schemas.

Use `database.transaction(async (tx) => { ... })` for atomic work; every statement in the callback must use `tx.query`, which has the same dialect selection and result format. Do not nest transactions or issue transaction-control SQL manually. Use InnoDB for all MySQL business tables. Failed work rolls back and releases the connection; rollback failure discards it. Avoid external network calls inside transactions. There is no automatic mutation retry, including timeouts or uncertain commit outcomes.

Connections have a 5-second establishment timeout and queries a 6-second client timeout. PostgreSQL also has a 5-second server statement timeout. MySQL fails immediately if the pool is at capacity and destroys timed-out connections; no unbounded pool wait queue is used. A client timeout does not prove a write failed: reconcile through workflow idempotency before retrying.

Changing drivers does not make arbitrary SQL portable. Maintain separate reviewed migrations per dialect for identity columns, date types, booleans, upserts, locking, and returned insert IDs. PostgreSQL can prevent overlapping bookings with exclusion constraints; MySQL must lock the relevant bay/vehicle rows in a consistent order and recheck overlap inside the reservation transaction. Test those invariants under concurrency against both real engines before enabling workflows. The current test suite verifies adapter behavior, not engine SQL or booking guarantees.

Next: add reviewed PostgreSQL and MySQL migrations for the supplied entities and contract extensions, then registration/login/session revocation and role middleware before exposing customer/vehicle endpoints. Implement engine-specific booking safeguards, invoice/payment transactions, audit events and idempotency in subsequent workflow slices.
