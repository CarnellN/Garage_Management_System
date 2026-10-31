# Database — garage_management_db

MySQL 8.0.16+ schema for the Garage Management System. All tables use InnoDB with `utf8mb4` charset.

## Quick start

```powershell
# 1. Create the database and application user (run as MySQL root)
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS garage_management_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 2. Apply the schema
mysql -u root -p garage_management_db < backend/database/schema.sql

# 3. Load seed data (development only)
mysql -u root -p garage_management_db < backend/database/seed.sql
```

Change `root` to your username and add `-P {your-port number}` after `-p` if your MySQL server is on a different port

> [!IMPORTANT]
> Create a dedicated least-privilege application user for the Express server. Do not use `root` in the `DATABASE_URL` environment variable.

## Files

| File         | Purpose                                                          |
| ------------ | ---------------------------------------------------------------- |
| `schema.sql` | Creates all 16 tables with constraints, indexes and foreign keys |
| `seed.sql`   | Inserts realistic sample data for development and demos          |

## Tables (16)

| #   | Table             | Description                                                   |
| --- | ----------------- | ------------------------------------------------------------- |
| 1   | `customer`        | Customer contact profiles                                     |
| 2   | `user`            | Login accounts with hashed passwords and role-based access    |
| 3   | `vehicle`         | Customer vehicles (registration, make, model, year, mileage)  |
| 4   | `bay`             | Service bays for scheduling and capacity management           |
| 5   | `booking`         | Service appointments with time interval and bay assignment    |
| 6   | `job_card`        | Work orders created from bookings or walk-ins                 |
| 7   | `service_task`    | Reusable task templates (service catalogue)                   |
| 8   | `task`            | Actual tasks performed on a specific job card                 |
| 9   | `part`            | Parts catalogue with current unit prices                      |
| 10  | `job_part`        | Junction table: parts consumed on a job card (price snapshot) |
| 11  | `invoice`         | Invoice header, one per job card                              |
| 12  | `invoice_line`    | Immutable line-item snapshots (labour and parts)              |
| 13  | `payment`         | Payment records against invoices                              |
| 14  | `payment_intent`  | Durable payment initiation records (M-Pesa, card, etc.)       |
| 15  | `audit_event`     | Append-only audit trail for all critical actions              |
| 16  | `idempotency_key` | Prevents duplicate mutation requests                          |

## Key relationships

```
customer  1──M  vehicle
customer  1──1  user          (CUSTOMER role only; staff have NULL customer_id)
vehicle   1──M  booking
vehicle   1──M  job_card
booking   1──0..1  job_card   (walk-ins have no booking)
job_card  1──M  task
job_card  M──M  part          (through job_part, with price snapshot)
job_card  1──0..1  invoice
invoice   1──M  invoice_line
invoice   1──M  payment
invoice   1──M  payment_intent
user (MECHANIC) 1──M  job_card
user      1──M  audit_event   (as actor)
```

## Normalisation notes (3NF)

- **No transitive dependencies**: every non-key attribute depends on the full primary key and nothing else.
- **Price snapshots**: `job_part.unit_price_snapshot` and `invoice_line.unit_price` capture the price at the time of use. Changing `part.unit_price` or the labour rate does not alter existing invoices.
- **Derived values**: `amount_paid`, `balance_due` and `payment_status` on invoices are computed at query time from the `payment` table — they are not stored columns.
- **No repeating groups**: the `job_part` junction table (composite PK) resolves the M:M relationship between job cards and parts.

## ENUMs

| Column                  | Values                                                                      |
| ----------------------- | --------------------------------------------------------------------------- |
| `user.role`             | `CUSTOMER`, `RECEPTIONIST`, `MECHANIC`, `ADMIN`                             |
| `booking.status`        | `PENDING`, `CONFIRMED`, `CHECKED_IN`, `COMPLETED`, `CANCELLED`, `NO_SHOW`   |
| `job_card.status`       | `OPEN`, `IN_PROGRESS`, `AWAITING_PARTS`, `COMPLETED`, `CLOSED`, `CANCELLED` |
| `invoice_line.kind`     | `LABOR`, `PART`                                                             |
| `payment.method`        | `CASH`, `CARD`, `MOBILE_MONEY`, `BANK_TRANSFER`                             |
| `payment_intent.status` | `PENDING`, `SUCCEEDED`, `FAILED`, `EXPIRED`                                 |
| `audit_event.outcome`   | `SUCCESS`, `DENIED`, `FAILURE`                                              |

## Seed data credentials

All seeded user accounts use the password **`Password123!`** (bcrypt hash). Replace the hash if your server uses Argon2id or a different algorithm.

| Email                        | Role         |
| ---------------------------- | ------------ |
| `james.mwangi@example.com`   | Customer     |
| `aisha.odhiambo@example.com` | Customer     |
| `peter.kamau@example.com`    | Customer     |
| `sarah.njeri@garage.local`   | Admin        |
| `john.kipchoge@garage.local` | Receptionist |
| `david.maina@garage.local`   | Mechanic     |
| `michael.ouma@garage.local`  | Mechanic     |
# Official database schema

[schema.sql](schema.sql) is the database developer's supplied MySQL 8.0.16+ / InnoDB schema, preserved unchanged as the integration reference. The database developer owns provisioning, migrations and seed data. The server never executes this file or creates tables at startup.

The server quotes the official lowercase names: `customer`, `user`, `vehicle`, `bay`, `booking`, `job_card`, `service_task`, `task`, `part`, `job_part`, `invoice`, `invoice_line`, `payment`, `payment_intent`, `audit_event`, and `idempotency_key`. In particular, part usage is singular `job_part`, and invoice lines use `invoice_line_id`. PostgreSQL support expects equivalent lowercase tables and matching columns; the supplied MySQL DDL itself is not PostgreSQL-compatible.

## Server mapping

- Vehicle create/update/read supports nullable `year` (1886–2100) and `mileage` (0–4,294,967,295).
- `invoice.currency` is written as KES. Totals and payment status remain derived; invoice lines and used-part prices are snapshots.
- `invoice_line.quantity` is DECIMAL(10,2). API part quantities are capped at 99,999,999 so they remain invoiceable; existing quantities above that limit produce a validation error during invoice issuance.
- `idempotency_key` uses `http_method`, `request_fingerprint`, `response_status` and `response_body`. `response_body` is an internal JSON envelope containing the public API body and replay headers (ETag/Location). `response_status` stores the HTTP status separately. Retry records and successful mutations/audit events commit together.
- The official utf8mb4_unicode_ci collation is case/accent insensitive. The server compares a matching stored retry key/path/method exactly before replay: collation collisions return 409, never another key's response. Prefer UUID keys and preserve their exact spelling.

## Sessions without a schema change

The official schema has no `auth_session` table. To preserve durable token revocation, the server reserves this namespace in the existing expiring key store:

| idempotency_key field | Session value |
| --- | --- |
| http_method | SESSION (never an HTTP route method) |
| path | /api/v1/auth/sessions |
| key | Signed token's UUID jti |
| user_id | Account owning the grant |
| request_fingerprint | SHA-256 fingerprint of the current account's role, customer link, activation and password hash |
| response_status / response_body | NULL; no password or bearer token is stored |
| created_at / expires_at | UTC grant lifetime, matching the token |

Every authenticated request checks the grant and current account. Logout deletes the grant; staff role/activation updates delete that user's SESSION records only. Password/role/link changes made out of band invalidate grants through the account fingerprint. Normal HTTP retry records are in a separate method/path namespace. Cleanup must delete only expired records; deleting unexpired SESSION records logs those users out. Share this storage convention with any process that manages the same table.

The first active admin is provisioned by the database/deployment owner with a server-generated salted scrypt hash (`scrypt$32768$8$1$<32 hex salt>$<128 hex hash>`) and null customer_id. New customer registrations create their profile/account atomically. The server enforces CUSTOMER/customer_id and staff/null linkage because the official schema leaves that rule at the application layer.

## Scheduling, payments and time

The official timestamps are DATETIME with whole-second precision. Connections set their session timezone to UTC, and booking writes reject nonzero fractional seconds to prevent silent boundary rounding. Opening hours use Africa/Nairobi; API responses use RFC 3339 UTC.

MySQL transactions explicitly use SERIALIZABLE for the next transaction, then acquire the existing application locks: actor account, vehicle, enabled bays in ID order, and overlapping bookings as appropriate. The booking read is a current FOR UPDATE read. Every booking writer must use the same reservation protocol; there is no MySQL exclusion constraint. Seed at least one enabled bay. Job writes lock the parent job and enforce version ETags. Invoices require unique job_card_id; payment writes lock the invoice and read settled payments plus PENDING payment intents with FOR UPDATE before checking unreserved balance. A pending intent's timestamp expiry does not alone prove a charge failed; reconcile its status before releasing its reservation.

`GET /payment-intents/{paymentIntentId}` reads existing intent status with invoice ownership checks. Checkout creation still returns PAYMENT_PROVIDER_NOT_CONFIGURED until a real provider, authenticated callbacks and reconciliation are implemented. Staff payment recording attests to a completed cash or independently verified non-cash transaction; a browser cannot settle money itself.

Use `backend/server/.env` and `npm run db:check` after the database developer provisions the schema. `npm test` checks identifiers and mocked workflows. For real-engine verification, run `npm run test:mysql` from `backend/server` with Docker running: it applies this schema to an isolated disposable MySQL 8.0 container and exercises all API routes plus competing booking/invoice/payment requests. It never reads your `.env` or changes the configured database. Keep database credentials and migration privileges outside the frontend. Deployment-specific integration and production-load testing remain separate.
