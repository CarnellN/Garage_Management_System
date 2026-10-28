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

> [!IMPORTANT]
> Create a dedicated least-privilege application user for the Express server. Do not use `root` in the `DATABASE_URL` environment variable.

## Files

| File | Purpose |
| --- | --- |
| `schema.sql` | Creates all 16 tables with constraints, indexes and foreign keys |
| `seed.sql` | Inserts realistic sample data for development and demos |

## Tables (16)

| # | Table | Description |
| --- | --- | --- |
| 1 | `customer` | Customer contact profiles |
| 2 | `user` | Login accounts with hashed passwords and role-based access |
| 3 | `vehicle` | Customer vehicles (registration, make, model, year, mileage) |
| 4 | `bay` | Service bays for scheduling and capacity management |
| 5 | `booking` | Service appointments with time interval and bay assignment |
| 6 | `job_card` | Work orders created from bookings or walk-ins |
| 7 | `service_task` | Reusable task templates (service catalogue) |
| 8 | `task` | Actual tasks performed on a specific job card |
| 9 | `part` | Parts catalogue with current unit prices |
| 10 | `job_part` | Junction table: parts consumed on a job card (price snapshot) |
| 11 | `invoice` | Invoice header, one per job card |
| 12 | `invoice_line` | Immutable line-item snapshots (labour and parts) |
| 13 | `payment` | Payment records against invoices |
| 14 | `payment_intent` | Durable payment initiation records (M-Pesa, card, etc.) |
| 15 | `audit_event` | Append-only audit trail for all critical actions |
| 16 | `idempotency_key` | Prevents duplicate mutation requests |

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

| Column | Values |
| --- | --- |
| `user.role` | `CUSTOMER`, `RECEPTIONIST`, `MECHANIC`, `ADMIN` |
| `booking.status` | `PENDING`, `CONFIRMED`, `CHECKED_IN`, `COMPLETED`, `CANCELLED`, `NO_SHOW` |
| `job_card.status` | `OPEN`, `IN_PROGRESS`, `AWAITING_PARTS`, `COMPLETED`, `CLOSED`, `CANCELLED` |
| `invoice_line.kind` | `LABOR`, `PART` |
| `payment.method` | `CASH`, `CARD`, `MOBILE_MONEY`, `BANK_TRANSFER` |
| `payment_intent.status` | `PENDING`, `SUCCEEDED`, `FAILED`, `EXPIRED` |
| `audit_event.outcome` | `SUCCESS`, `DENIED`, `FAILURE` |

## Seed data credentials

All seeded user accounts use the password **`Password123!`** (bcrypt hash). Replace the hash if your server uses Argon2id or a different algorithm.

| Email | Role |
| --- | --- |
| `james.mwangi@example.com` | Customer |
| `aisha.odhiambo@example.com` | Customer |
| `peter.kamau@example.com` | Customer |
| `sarah.njeri@garage.local` | Admin |
| `john.kipchoge@garage.local` | Receptionist |
| `david.maina@garage.local` | Mechanic |
| `michael.ouma@garage.local` | Mechanic |
