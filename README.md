# Garage Management System

Garage operations for customers, receptionists, mechanics and administrators.

- [User manual](docs/USER_MANUAL.md) — installation, every role's workflows, reports, troubleshooting
- [API contract](docs/openapi.yaml)
- [Express backend setup](backend/server/README.md)
- [Frontend API guide and fetch client](docs/FRONTEND_API.md)
- [Database integration handoff](backend/database/README.md)

## Quick start

With Docker: `cp deploy/.env.example deploy/.env`, fill in the secrets, then `docker compose --env-file deploy/.env up -d --build` (web on port 8080, API docs on `http://localhost:8000/api/docs`). Without Docker: `cd backend/server && npm install && npm run setup` runs the installation wizard. Details are in the [user manual](docs/USER_MANUAL.md#2-installing-the-system).

## Features

- Customers, vehicles, appointment booking with bay capacity and no double-booking, job cards, tasks, parts, invoices and payments.
- Roles: customer, receptionist, mechanic, administrator, with ownership checks on every request.
- Login/logout, registration, forgot-password email reset, password change, optional TOTP two-factor authentication.
- M-Pesa (Safaricom Daraja STK push) online payment, verified server-to-server before settlement.
- Branded PDF/JSON reports (revenue, bookings, job cards, outstanding invoices, audit trail) and invoice PDFs, with date filters and sorting.
- Audit trail of successful and failed actions, sign-ins and report exports.
- Scrypt password hashes, AES-256-GCM encryption of 2FA secrets, prepared statements, rate limiting.

The backend uses Express with MySQL. See its README for local setup, Aiven connection settings, database health checks, environment variables and implementation status.
