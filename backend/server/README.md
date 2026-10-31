# Garage Management API

Express 5 API for [the API contract](../../docs/openapi.yaml), using Node.js 22+. Uses MySQL 8.0.16+ through `mysql2` by default, with Supabase/PostgreSQL through `pg` available as a backup deployment option.

Implemented: 54 business operations for authentication, staff accounts, customers, vehicles, bookings, job cards, tasks, part usage/catalogs, service templates, invoices, settled payments and audit reads. Includes role/ownership checks, request validation from OpenAPI, ETags, transactional audit and durable idempotency. Online checkout creation returns `503 PAYMENT_PROVIDER_NOT_CONFIGURED` until a provider is integrated; existing payment intents can be read with ownership checks. See the [frontend integration guide](../../docs/FRONTEND_API.md) and [database handoff](../database/README.md).

The database developer owns provisioning and migrations. This server does not change the schema. The server now targets the official lowercase MySQL tables in `backend/database/schema.sql`. Session grants use an isolated SESSION namespace in the existing `idempotency_key` table; no additional session table is required. Missing schema returns `SCHEMA_NOT_READY`. Tests use database doubles; actual SQL/constraints and concurrency must be validated against the provisioned engines before release.

## Local setup

From the repository root in PowerShell:

```powershell
cd backend/server
npm.cmd install
Copy-Item .env.example .env
# Edit .env locally with your database connection information.
# Generate a JWT signing secret, then save the value as JWT_SECRET in .env:
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
# Confirm GARAGE_OPEN_TIME, GARAGE_CLOSE_TIME, GARAGE_OPEN_DAYS and LABOR_HOURLY_RATE.
npm.cmd run db:check
npm.cmd run dev
```

Use `npm ci` for subsequent clean installs with the committed lockfile. On shells without PowerShell execution-policy restrictions, `npm` works in place of `npm.cmd`. `npm start` runs without file watching; `npm test` runs HTTP, configuration and adapter lifecycle tests with mocked driver pools. These tests do not connect to a real database.

## Real MySQL integration tests

With Docker Desktop running, execute `npm.cmd run test:mysql` from `backend/server`. The test starts a disposable `mysql:8.0` container, applies the official schema unchanged, bootstraps only test accounts, and exercises all 55 API routes. It checks authentication/ownership, searches and joined lists, retry replay, timestamp handling, immutable invoice snapshots, pending payment reservations, and competing booking/invoice/payment requests. Checkout creation is expected to return PAYMENT_PROVIDER_NOT_CONFIGURED.

The harness does not load `.env` or use your configured DATABASE_URL. It uses a unique container name, a random loopback-only port, test-only credentials and a temporary in-memory database volume. It closes the HTTP server/pool and stops/removes its own labeled container on completion or test failure. The Docker image is cached locally for subsequent runs. First use may download the image; allow a few minutes and Docker access on Windows. Do not run this command as a production database smoke test.

Verified on 29 October 2026 with MySQL 8.0.46: all eight integration scenarios passed, exercising all 55 operation routes. The 51 unit/API tests also passed. These targeted competing-request checks do not replace production-load/performance testing or verification of the deployment's own database configuration. PostgreSQL has not been verified against a real engine by this suite.

MySQL connection/transaction setup commands use the text protocol because SET TRANSACTION is unsupported by MySQL's prepared-statement protocol. Application data statements continue using prepared execution with bound values. Unit tests cover this distinction to prevent regressions.

## Choose the database

`DB_CLIENT` defaults to `mysql`. Set `DB_CLIENT=postgres` explicitly to use the Supabase/PostgreSQL backup option; the `DATABASE_URL` scheme must match. Restart the server after changing providers. This selects one database per running server; switching is manual and does not migrate or replicate data or provide automatic failover.

For local MySQL, create `garage_management_db` and a password-protected application user, then configure:

```dotenv
DB_CLIENT=mysql
DATABASE_URL=mysql://garage_user:ENCODED_PASSWORD@localhost:3306/garage_management_db
DB_SSL=false
```

For hosted MySQL, use its actual host/port, `DB_SSL=true`, and `DB_SSL_CA_FILE` if the provider requires a CA certificate. Certificate verification remains enabled. MySQL URIs must not contain query options; driver options are configured in code. `DB_SSL=false` is only allowed for localhost outside production. Use MySQL 8.0.16+ with InnoDB for enforced CHECK constraints, foreign keys and transactions. Run `npm.cmd run db:check` to test the selected connection. Supabase itself provides PostgreSQL; it is the alternative deployment provider.

## Supabase backup connection

To switch to Supabase, set `DB_CLIENT=postgres` and `DB_SSL=true`. In the Supabase dashboard, open **Connect**, select **Session pooler**, and copy the PostgreSQL URI into `DATABASE_URL` in `backend/server/.env`. Copy your project's actual username and host. Replace the password placeholder with the URL-encoded database password; keep secrets out of the frontend, Git, screenshots and chat. This server connects over PostgreSQL and does not require an anon or service-role API key.

The session pooler is useful for a persistent Express process, especially on IPv4 networks. A direct connection also works if the deployment supports the network requirements. The Supabase physical database is generally `postgres`; `garage_management_db` remains the project's logical database name. Do not change the URI database name unless you have actually created that database.

TLS certificate verification is enabled. If your endpoint requires Supabase's database CA, download the certificate from the project settings, save it to `backend/server/certs/supabase-ca.crt`, and set `DB_SSL_CA_FILE=./certs/supabase-ca.crt`. Relative paths resolve from the backend working directory. Do not add SSL query options such as `sslmode` to the URI: configure TLS only through `DB_SSL`/`DB_SSL_CA_FILE` so URI parsing cannot weaken verification. `DB_SSL=false` is accepted only for localhost outside production.

`DB_POOL_MAX` defaults to 5 per server process; budget the sum across all replicas against your project limits. Use a dedicated least-privilege database login when provisioning the schema. A privileged database connection does not enforce end-user ownership automatically: business routes authenticate users and enforce the contract's role and ownership checks in transactions. Do not treat CORS as authorization.

Reference: [Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [node-postgres TLS configuration](https://node-postgres.com/features/ssl).

## Runtime

The default listener is `http://127.0.0.1:8000`; business routes live under `/api/v1`. Set `HOST=0.0.0.0` for containers and deploy behind HTTPS. Set an explicit `CORS_ORIGINS` comma-separated list in production. Proxy trust is disabled until the deployment's exact proxy topology is configured. JWT_SECRET must contain at least 32 bytes and is required in production; use cryptographically random material. Sessions last 900 seconds by default, are checked against durable SESSION grants in idempotency_key on each request, and are revoked by logout or staff role/activation changes. Authentication routes are rate-limited to 30 requests per source IP per 15 minutes in this process; use a shared limiter store/gateway when scaling across replicas.

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Process liveness, no database query |
| `GET /health/ready` | Runs `SELECT 1`; returns 503 if the database is unavailable |
| `GET /api/v1` | Operation discovery and implementation status |
| `GET /api/openapi.json` | Machine-readable OpenAPI contract |
| `/api/docs` | Interactive Swagger UI |

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

The official schema uses lowercase names (including singular `job_part`), `invoice_line_id`, and DATETIME(0). Booking writes require whole seconds; MySQL session timestamps are UTC. MySQL transactions explicitly use SERIALIZABLE. Changing drivers does not make arbitrary SQL portable. Maintain separate reviewed migrations per dialect for identity columns, date types, booleans, upserts, locking, and returned insert IDs. PostgreSQL can prevent overlapping bookings with exclusion constraints; MySQL must lock the relevant bay/vehicle rows in a consistent order and recheck overlap inside the reservation transaction. Test those invariants under concurrency against both real engines before enabling workflows. The current test suite checks adapter behavior, schema identifiers, HTTP workflows and boundary rules; it does not establish real-engine SQL or concurrent booking guarantees.

Keep the repository's `docs/openapi.yaml` available at runtime: request validation and Swagger UI read it using a path relative to the source files. Run `npm run client:generate` after contract changes to regenerate `docs/api-operations.json`. Deploy the server with its contract, and coordinate schema requirements with the database developer before running real workflows. Online checkout still requires a provider adapter with authenticated confirmations and reconciliation; no client request can settle online money.
