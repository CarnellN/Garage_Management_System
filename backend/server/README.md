# Garage Management API

Express 5 API for [the API contract](../../docs/openapi.yaml), using Node.js 22+ and MySQL 8.0.16+ through `mysql2`.

Implemented: all 70 operations — authentication (registration, login/logout, forgot/reset/change password, TOTP two-factor), staff accounts, customers, vehicles, bookings, job cards, tasks, part usage/catalogs, service templates, invoices, payments, M-Pesa STK push checkout, PDF/JSON reports and audit reads. Includes role/ownership checks, request validation from OpenAPI, ETags, transactional audit (including failed changes) and durable idempotency. M-Pesa checkout returns `503 PAYMENT_PROVIDER_NOT_CONFIGURED` until the `MPESA_*` settings are provided. End-user instructions are in the [user manual](../../docs/USER_MANUAL.md). See the [frontend integration guide](../../docs/FRONTEND_API.md) and [database handoff](../database/README.md).

The server targets the lowercase MySQL tables in `backend/database/schema.sql` (18 tables, including `user_mfa` and `password_reset`). The API process never changes the schema itself; `npm run db:init`, `npm run setup` or the Docker start command apply `schema.sql` and `migrations/` explicitly. Session grants use an isolated SESSION namespace in the existing `idempotency_key` table; no additional session table is required. Missing schema returns `SCHEMA_NOT_READY`. Tests use database doubles; actual SQL/constraints and concurrency must be validated against the provisioned engines before release.

## Local setup

Quickest: `npm install` then `npm run setup` — an interactive wizard that writes `.env.local` with generated secrets, checks the database, installs tables (optionally demo data) and creates the first admin. For containers, see `docker-compose.yml` at the repository root and the [user manual](../../docs/USER_MANUAL.md#2-installing-the-system).

Manual setup from the repository root in PowerShell:

```powershell
cd backend/server
npm.cmd install
Copy-Item .env.example .env.local
# Edit .env.local locally with your database connection information.
# Generate a JWT signing secret, then save the value as JWT_SECRET in .env.local:
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
# Confirm GARAGE_OPEN_TIME, GARAGE_CLOSE_TIME, GARAGE_OPEN_DAYS and LABOR_HOURLY_RATE.
npm.cmd run db:check
npm.cmd run db:init
npm.cmd run admin:create
npm.cmd run dev
```

Use `npm ci` for subsequent clean installs with the committed lockfile. On shells without PowerShell execution-policy restrictions, `npm` works in place of `npm.cmd`. `npm start` runs without file watching; `npm test` runs HTTP, configuration and adapter lifecycle tests with mocked driver pools. These tests do not connect to a real database.

## Real MySQL integration tests

With Docker Desktop running, execute `npm.cmd run test:mysql` from `backend/server`. The test starts a disposable `mysql:8.0` container, applies the schema, bootstraps only test accounts, and exercises all 70 API routes. It checks authentication/ownership, two-factor login, password reset/change, searches and joined lists, retry replay, timestamp handling, immutable invoice snapshots, pending payment reservations, M-Pesa settlement through the callback and refresh paths (with a stand-in for Safaricom's API), every report's SQL as JSON and PDF, and competing booking/invoice/payment requests.

The harness does not load `.env` or use your configured DATABASE_URL. It uses a unique container name, a random loopback-only port, test-only credentials and a temporary in-memory database volume. It closes the HTTP server/pool and stops/removes its own labeled container on completion or test failure. The Docker image is cached locally for subsequent runs. First use may download the image; allow a few minutes and Docker access on Windows. Do not run this command as a production database smoke test.

Verified on 18 November 2026 with MySQL 8.0.46: all nine integration scenarios passed, exercising all 70 operation routes. The 59 unit/API tests also passed. These targeted competing-request checks do not replace production-load/performance testing or verification of the deployment's own database configuration.

MySQL connection/transaction setup commands use the text protocol because SET TRANSACTION is unsupported by MySQL's prepared-statement protocol. Application data statements continue using prepared execution with bound values. Unit tests cover this distinction to prevent regressions.

## Choose the database

MySQL is the supported database. The server accepts either a `DATABASE_URL` or Aiven's individual connection fields. Connection fields are useful when the provider supplies separate values:

For local MySQL, create `garage_management_db` and a password-protected application user, then configure:

```dotenv
DB_CLIENT=mysql
DATABASE_URL=mysql://garage_user:ENCODED_PASSWORD@localhost:3306/garage_management_db
DB_SSL=false
```

For Aiven, set `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and `DB_PORT`, then set `DB_SSL=true`. If Aiven supplies a CA certificate, set `DB_CA` to its complete PEM text (quoted across lines in `.env.local`) or save it as a file and set `DB_SSL_CA_FILE`. Certificate verification remains enabled. MySQL URIs must not contain query options; driver options are configured in code. `DB_SSL=false` is only allowed for localhost outside production. Use MySQL 8.0.16+ with InnoDB for enforced CHECK constraints, foreign keys and transactions. `npm.cmd run db:check` reads `.env.local` and checks the configured connection.

`DB_POOL_MAX` defaults to 5 per server process; budget the sum across all replicas against provider limits. Use a dedicated least-privilege database login when provisioning the schema. A privileged database connection does not enforce end-user ownership automatically: business routes authenticate users and enforce the contract's role and ownership checks in transactions. Do not treat CORS as authorization.

## Runtime

The default listener is `http://127.0.0.1:8000`; business routes live under `/api/v1`. Set `HOST=0.0.0.0` for containers and deploy behind HTTPS. Set an explicit `CORS_ORIGINS` comma-separated list in production. Proxy trust is disabled until the deployment's exact proxy topology is configured. JWT_SECRET must contain at least 32 bytes and is required in production; use cryptographically random material. Sessions last 900 seconds by default, are checked against durable SESSION grants in idempotency_key on each request, and are revoked by logout or staff role/activation changes. Authentication routes are rate-limited to 30 requests per source IP per 15 minutes in this process; use a shared limiter store/gateway when scaling across replicas.

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Process liveness, no database query |
| `GET /health/ready` | Runs `SELECT 1`; returns 503 if the database is unavailable |
| `GET /api/v1` | Operation discovery and implementation status |
| `GET /api/openapi.json` | Machine-readable OpenAPI contract |
| `/api/docs` | Interactive Swagger UI |

## Roles and access

Every protected route checks the caller's role against the operation's `x-roles` list in `docs/openapi.yaml` and returns `403 FORBIDDEN` otherwise (`src/api/router.js`). Roles are re-read from the database on each request, so role or activation changes take effect immediately.

| Role | Access |
| --- | --- |
| `CUSTOMER` | Own customer profile, vehicles, bookings, job cards, invoices and payments only. Other customers' records return 404. Read-only parts and service-task catalogues. |
| `RECEPTIONIST` | All customers, vehicles, bookings, job cards, invoices and payment recording. Cannot manage users, parts or service tasks, or read audit events. |
| `MECHANIC` | Only job cards assigned to them: status, tasks and part usage. Cannot cancel or close jobs. |
| `ADMIN` | Everything, including users, parts, service tasks and audit events. |

The client's portal checks (`client/src/lib/auth.jsx`) only control navigation; the server is what enforces access.

Health probes are infrastructure endpoints outside the business OpenAPI contract. They do not check that application tables have been migrated. The server verifies database connectivity before listening. No migrations or remote writes run automatically. SIGINT/SIGTERM stop accepting traffic, drain active requests, and close the database pool; shutdown is bounded to 10 seconds.

## Database interface and SQL portability

The database adapter exposes `driver`, `query(sql, values)`, `transaction(work)`, `check()` and `close()`. Queries return `{ rows, rowCount, insertId }`; MySQL inserts expose `insertId`. For SELECT, `rowCount` is the number of returned rows. For MySQL UPDATE, the driver reports matched rows by default; do not assume it counts changed values. Keep database-specific behavior inside repositories, away from HTTP handlers.

Supply values separately and use native placeholders, or supply both SQL dialects:

```js
const result = await database.query('SELECT * FROM customer WHERE customer_id = ?', [customerId]);
```

MySQL uses prepared execution and disables multiple statements. Exact DECIMAL and large integer values remain strings. MySQL date/time columns return strings; repositories must write UTC and serialize date/time fields to RFC 3339 for the API. Avoid database-generated local timestamps unless the session timezone is explicitly UTC. MySQL dates, boolean fields and insert results need explicit repository mapping to the API schemas.

Use `database.transaction(async (tx) => { ... })` for atomic work; every statement in the callback must use `tx.query`, which has the same dialect selection and result format. Do not nest transactions or issue transaction-control SQL manually. Use InnoDB for all MySQL business tables. Failed work rolls back and releases the connection; rollback failure discards it. Avoid external network calls inside transactions. There is no automatic mutation retry, including timeouts or uncertain commit outcomes.

Connections have a 5-second establishment timeout and queries a 6-second client timeout. MySQL fails immediately if the pool is at capacity and destroys timed-out connections; no unbounded pool wait queue is used. A client timeout does not prove a write failed: reconcile through workflow idempotency before retrying.

The official schema uses lowercase names (including singular `job_part`), `invoice_line_id`, and DATETIME(0). Booking writes require whole seconds; MySQL session timestamps are UTC. MySQL transactions explicitly use SERIALIZABLE. MySQL must lock the relevant bay/vehicle rows in a consistent order and recheck overlap inside the reservation transaction. Verify those invariants under concurrency against the provisioned database before enabling workflows. The current test suite checks schema identifiers, HTTP workflows and boundary rules; it does not establish real-engine SQL or concurrent booking guarantees.

## Security features, payments and reports

- **Passwords:** salted scrypt hashes. Forgot-password emails a 256-bit single-use token valid for 30 minutes (only its SHA-256 is stored); reset and change revoke all sessions. Configure `SMTP_*`; without SMTP, development servers print the email to the log and production servers log `mail_not_configured`.
- **Two-factor:** RFC 6238 TOTP (6 digits, 30 s, ±1 step) with replay protection. Secrets are encrypted with AES-256-GCM using `DATA_ENCRYPTION_KEY` (or an HKDF key derived from `JWT_SECRET`). Login returns `401 MFA_REQUIRED` until `otp` is supplied.
- **M-Pesa:** `src/services/mpesa.js` implements Daraja OAuth, STK push and STK query. Checkout commits the PENDING reservation before calling Safaricom, so no lock is held during the network call. The callback (`POST /api/v1/payments/mpesa/callback/<MPESA_CALLBACK_TOKEN>`, outside the OpenAPI contract) is confirmed by an STK query before one payment is inserted; duplicates are ignored. `refreshPaymentIntent` performs the same query on demand.
- **Reports:** `src/reports/pdf.js` (PDFKit) renders A4 documents with logo (`GARAGE_LOGO_FILE` or a drawn logo), company name/contacts, title, filters, generation date/time (EAT), generated-by and page numbers. Report SQL is bounded (366 days, 5000 rows) and sort columns are allowlisted. Each export is audited.
- **Audit:** successful mutations commit with their audit event; failed mutations, denials and failed logins are recorded afterwards with outcome FAILURE/DENIED.

Keep the repository's `docs/openapi.yaml` available at runtime: request validation and Swagger UI read it using a path relative to the source files. Run `npm run client:generate` after contract changes to regenerate `docs/api-operations.json`. Deploy the server with its contract, and coordinate schema requirements with the database developer before running real workflows. Online checkout still requires a provider adapter with authenticated confirmations and reconciliation; no client request can settle online money.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Login returns `503 AUTH_NOT_CONFIGURED` ("Authentication is not configured on this server.") | `JWT_SECRET` in `.env.local` is empty. In development the server still starts, but every auth route returns 503. Generate a secret with the command in [Local setup](#local-setup), set `JWT_SECRET=<value>`, and restart the server (`npm run dev` watches source files, not `.env.local`). |
| Server exits with `JWT_SECRET must contain at least 32 bytes.` | The secret is too short. Use the generator command, which produces 64 characters. |
| Login with a seeded account returns 401 | The stored password hash is not in the server's scrypt format (for example an old bcrypt hash). See [Password hash format](../database/README.md#password-hash-format). |
| Login returns 429 | Auth routes allow 30 attempts per IP per 15 minutes. Wait, or restart the server in development to reset the in-memory limiter. |
| A logged-in user gets 403 `FORBIDDEN` | Their role is not allowed on that operation; see [Roles and access](#roles-and-access). |
