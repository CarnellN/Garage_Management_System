# Garage Management API

Express 5 server foundation for [the API contract](../docs/openapi.yaml), using Node.js 22+ and Supabase Postgres through `pg`.

Implemented: verified TLS database pool, parameterized-query/transaction helpers, environment validation, security headers, exact-origin CORS, correlation IDs, sanitized JSON errors, health probes, startup connectivity checks, and graceful shutdown. Authentication, database migrations, and the business endpoints in the contract are the next implementation stage. Unimplemented endpoints return 404; no customer or financial data is exposed yet.

## Local setup

From the repository root in PowerShell:

```powershell
cd backend
npm.cmd install
Copy-Item .env.example .env
# Edit .env locally with the connection information from your Supabase project.
npm.cmd run db:check
npm.cmd run dev
```

Use `npm ci` for subsequent clean installs with the committed lockfile. On shells without PowerShell execution-policy restrictions, `npm` works in place of `npm.cmd`. `npm start` runs without file watching; `npm test` runs HTTP and configuration tests without Supabase credentials or database access.

## Supabase connection

In the Supabase dashboard, open **Connect**, select **Session pooler**, and copy the PostgreSQL URI into `DATABASE_URL` in `backend/.env`. Copy your project's actual username and host. Replace the password placeholder with the URL-encoded database password; keep secrets out of the frontend, Git, screenshots and chat. This server connects over PostgreSQL and does not require an anon or service-role API key.

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

Database calls have connection/query timeouts. Supply SQL data as parameters (`database.query('SELECT ... WHERE id = $1', [id])`), never interpolate input. Use `database.transaction(async (client) => { ... })` for atomic work; statements within a transaction must use that client. Avoid external network calls inside transactions. There is no automatic retry of mutations.

Next: add reviewed PostgreSQL migrations for the supplied entities and contract extensions, then registration/login/session revocation and role middleware before exposing customer/vehicle endpoints. Implement booking exclusion constraints, invoice/payment transactions, audit events and idempotency in subsequent workflow slices.
