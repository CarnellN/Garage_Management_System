# Garage Management System — User Manual

This manual explains how to install the system, how each type of user works with it, and what to do when something goes wrong.

- [1. Who uses the system](#1-who-uses-the-system)
- [2. Installing the system](#2-installing-the-system)
- [3. Signing in, passwords and two-factor authentication](#3-signing-in-passwords-and-two-factor-authentication)
- [4. Customers](#4-customers)
- [5. Receptionists](#5-receptionists)
- [6. Mechanics](#6-mechanics)
- [7. Administrators](#7-administrators)
- [8. Payments and M-Pesa](#8-payments-and-m-pesa)
- [9. Reports](#9-reports)
- [10. Audit trail](#10-audit-trail)
- [11. Error messages and troubleshooting](#11-error-messages-and-troubleshooting)
- [12. Security summary](#12-security-summary)

The API reference with a "Try it out" button for every operation is at `http://<server>:8000/api/docs` once the server is running. Every operation named in this manual (for example `createBooking`) appears there.

---

## 1. Who uses the system

| Role | What they can do |
| --- | --- |
| **Customer** | Register, manage their own vehicles, book, reschedule or cancel appointments, follow repair progress, view and download invoices, pay by M-Pesa. |
| **Receptionist** | Everything at the front desk: customer profiles, vehicles, bookings, opening job cards, assigning mechanics, invoicing, recording payments, bookings/job/outstanding-invoice reports. |
| **Mechanic** | Sees only the job cards assigned to them; records tasks, hours and parts; moves jobs through *In progress → Awaiting parts → Completed*; prints their own job report. |
| **Administrator** | Everything a receptionist can do, plus staff accounts, the parts and service catalogue, revenue and audit reports, and removing a lost two-factor device. |

A customer never sees another customer's data. A mechanic never sees jobs assigned to someone else. Anything out of scope is answered with *"The resource does not exist"* so that nobody can probe for other people's records.

---

## 2. Installing the system

### Option A — Docker (recommended, one command)

Requirements: Docker Desktop (Windows/macOS) or Docker Engine with Compose (Linux).

```bash
cp deploy/.env.example deploy/.env
```

Open `deploy/.env` and set at least `DB_PASSWORD`, `DB_ROOT_PASSWORD` and `JWT_SECRET` (the file shows the command that generates a secret). Set `SEED_DEMO=true` if you want sample data. Then:

```bash
docker compose --env-file deploy/.env up -d --build
```

```bash
docker compose --env-file deploy/.env run --rm api node scripts/create-admin.js
```

The second command asks for the first administrator's name, email and password. The web client is then at `http://localhost:8080` and the API documentation at `http://localhost:8000/api/docs`. Tables are created (or upgraded) automatically every time the API starts.

### Option B — Installation wizard (local MySQL)

Requirements: Node.js 22 or newer and MySQL 8.0.16 or newer with an empty database and a user that may create tables.

```bash
cd backend/server
npm install
npm run setup
```

The wizard asks for the database connection, the garage's name, address, phone, opening hours and labour rate, then:

1. generates the signing and encryption secrets and writes them to `backend/server/.env.local` (readable only by you);
2. checks the database connection;
3. creates or upgrades all tables (and optionally loads demo data);
4. creates the first administrator account.

Start the server with `npm run dev` (development, restarts on code changes) or `npm start`.

Other maintenance commands, all run from `backend/server`:

| Command | Purpose |
| --- | --- |
| `npm run db:check` | Test the database connection settings. |
| `npm run db:init` | Create or upgrade tables (safe to repeat). Add `-- --seed` to load demo data into an empty database. |
| `npm run admin:create` | Create another administrator, or reset an administrator's password. |
| `npm test` | Run the automated tests (no database needed). |
| `npm run test:mysql` | Run the full test suite against a disposable MySQL container (Docker required). |

### Demo accounts

When demo data is loaded every account below uses the password **`Password123!`**. Change or disable them before real use.

| Email | Role |
| --- | --- |
| `sarah.njeri@garage.local` | Administrator |
| `john.kipchoge@garage.local` | Receptionist |
| `david.maina@garage.local`, `michael.ouma@garage.local` | Mechanic |
| `james.mwangi@example.com`, `aisha.odhiambo@example.com`, `peter.kamau@example.com` | Customer |

### Optional settings

Add these to `.env.local` (wizard install) or `deploy/.env` (Docker). `.env.example` lists every option with comments.

- **Email** — `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` for password reset emails. Without SMTP, a development server prints the reset email (including the link) to its console so the flow can still be demonstrated.
- **M-Pesa** — see [section 8](#8-payments-and-m-pesa).
- **Logo** — `GARAGE_LOGO_FILE=/path/to/logo.png`. Without it, reports show a gear logo with the garage's initials.

---

## 3. Signing in, passwords and two-factor authentication

### Registering (customers)

Customers create their own account with name, email, optional phone and a password of **at least 12 characters** (`registerCustomer`). Staff accounts are created by an administrator.

### Signing in and out

Sign in with email and password (`login`). Sessions last 15 minutes by default; sign in again when told *"The session is no longer valid."* Signing out (`logout`) ends the session immediately on the server, not just in the browser.

After 30 sign-in attempts from the same computer in 15 minutes, further attempts are refused for a while (*"Too many authentication attempts"*). This protects accounts from password guessing.

### Forgot password

1. Choose **Forgot password** and enter your email (`requestPasswordReset`). The reply is always the same, whether or not the email has an account, so nobody can use this page to find out who is registered.
2. Open the email and follow the link within **30 minutes**. The link works **once**; asking for another link cancels the previous one.
3. Choose a new password (`resetPassword`). You are signed out on every device and can sign in with the new password.

### Changing your password

While signed in, supply your current password and a new one (`changePassword`). All your sessions end, including the current one, so sign in again.

### Two-factor authentication (2FA)

Two-factor authentication adds a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy and similar) to every sign-in. It is strongly recommended for staff, and especially administrators.

1. **Start setup** (`setupMfa`). You receive a secret and an `otpauth://` link. Turn the link into a QR code and scan it with the app, or type the secret into the app manually.
2. **Confirm** by entering the code the app shows (`enableMfa`). Two-factor is now on.
3. From now on, sign-in asks for the code after the password (the `otp` field). A code can be used only once.
4. To **turn it off**, provide your password and a current code (`disableMfa`).

Lost your phone? Ask an administrator to remove your device (`resetUserMfa`); you can then sign in with your password alone and set up a new device.

---

## 4. Customers

**Vehicles.** Add each vehicle with its registration number (stored in capitals; it must be unique), and optionally make, model, year and mileage (`createVehicle`, `updateVehicle`). A vehicle with service history cannot be deleted, so its records stay intact.

**Booking an appointment.**

1. Check free slots for a date range (`listAvailability`). The garage's opening hours (Africa/Nairobi time) and free service bays determine what is shown.
2. Book a slot of up to 8 hours for one of your vehicles (`createBooking`). The booking starts as **Pending** until the garage confirms it.
3. To move it, reschedule (`rescheduleBooking`) while it is Pending or Confirmed. To cancel, set its status to Cancelled (`updateBookingStatus`) before the appointment starts.

The system will never double-book a bay or a vehicle, even when two people book the same slot at the same moment: one booking succeeds and the other is told *"The vehicle or garage capacity is already reserved for this interval."*

**Following the repair.** Your vehicle's job cards show the status, the tasks performed and the parts used (`listJobCards`, `listJobTasks`, `listJobParts`).

**Invoices and payment.** Open the invoice (`getInvoice`) to see each labour and parts line, amount paid and balance. Download a printable PDF (`getInvoicePdf`). Pay the balance by M-Pesa from your phone ([section 8](#8-payments-and-m-pesa)) or at the front desk.

---

## 5. Receptionists

**Customers.** Search customers by name, email or phone (`listCustomers`), create walk-in profiles (`createCustomer`) and correct details (`updateCustomer`).

**Bookings.** Confirm pending bookings, mark no-shows after the start time, reschedule or cancel (`updateBookingStatus`, `rescheduleBooking`). Filter the booking list by vehicle, status and date (`listBookings`).

**Opening a job card.** When the vehicle arrives, open a job card for it and choose a mechanic (`createJobCard`). Link the confirmed booking if there is one; the booking then shows **Checked in**. A vehicle can have only one active job card at a time. Re-assign the job to another mechanic if needed (`assignMechanic`).

**Invoicing.** When the mechanic marks the job **Completed**, issue the invoice (`createInvoice`). The invoice is calculated by the server: each task's hours × the labour rate, plus each part's quantity × the price at the time it was used. Invoices never change afterwards, even if catalogue prices change.

**Recording payments.** Record cash, card, M-Pesa or bank payments taken at the desk (`recordPayment`). Non-cash payments need the transaction reference (for example the M-Pesa receipt code); the same reference can never be recorded twice. The system refuses any payment larger than the remaining balance.

**Closing the job.** Once the invoice is fully paid, close the job card (status **Closed**).

---

## 6. Mechanics

1. See your assigned jobs (`listJobCards`).
2. Move the job to **In progress** (`updateJobCardStatus`).
3. Add each task with its standard hours (`createJobTask`). Use the service catalogue (`listServiceTasks`) for standard names and hours.
4. Record parts used and their quantity (`setJobPartQuantity`); the current catalogue price is captured at that moment.
5. Use **Awaiting parts** while waiting for stock, then back to **In progress**.
6. Mark **Completed** when done. Every task must have hours before a job can be completed.

Job cards use version numbers (ETags). If someone else changed the job since you opened it, you are told *"The resource has changed. Fetch its latest ETag."* Reload the job and repeat your change; nothing is lost or overwritten silently.

---

## 7. Administrators

- **Staff accounts.** Create receptionists, mechanics and administrators (`createStaffUser`), change roles, or deactivate accounts (`updateStaffUser`). Changing a role or deactivating an account signs that person out immediately. The last active administrator cannot be demoted or disabled, and a mechanic with active jobs must have them re-assigned first.
- **Catalogue.** Maintain parts with prices (`createPart`, `updatePart`) and service tasks with standard hours (`createServiceTask`). Parts already used on a job cannot be deleted.
- **Two-factor recovery.** Remove a user's lost 2FA device (`resetUserMfa`).
- **Reports and audit.** All reports in [section 9](#9-reports) and the audit trail in [section 10](#10-audit-trail).

---

## 8. Payments and M-Pesa

### How an M-Pesa payment works

1. The customer (or receptionist) starts an online payment for an amount up to the invoice balance, in whole shillings, with method **MOBILE_MONEY** and optionally a Safaricom number (`createPaymentIntent`). If no number is given, the phone on the customer's profile is used.
2. The amount is reserved against the invoice so it cannot be paid twice, and the customer's phone shows the M-Pesa PIN prompt.
3. When the customer enters their PIN, Safaricom notifies the server. The server **double-checks the result directly with Safaricom** before recording anything, then records exactly one payment with the M-Pesa receipt code.
4. Check progress at any time (`getPaymentIntent`). If the server could not be reached by Safaricom (for example during local development), press **refresh** (`refreshPaymentIntent`): the server asks Safaricom for the result and settles or releases the payment.

If the customer cancels the prompt or it times out, the payment is marked **Failed** and the reserved amount is released.

### Turning M-Pesa on

1. Create an app on the [Safaricom Daraja portal](https://developer.safaricom.co.ke) to get a consumer key and secret. For testing, the sandbox's Lipa Na M-Pesa Online shortcode `174379` and its passkey are listed on the portal.
2. The server must be reachable on a public **https** address. In development use a tunnel such as ngrok and put its address in `MPESA_CALLBACK_BASE_URL`.
3. Set all of: `MPESA_ENV` (`sandbox` or `production`), `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_BASE_URL`, and `MPESA_CALLBACK_TOKEN` (32+ random characters).
4. Restart the server. The start-up log shows `mpesa: 'sandbox'` (or `production`).

Until M-Pesa is configured, online payment returns *"Online checkout is not configured. Contact the garage to arrange payment."* and payments are recorded at the front desk.

---

## 9. Reports

Every report is available as a **PDF** (default) or as **JSON** (`format=json`). Each PDF carries the garage logo, name and contact details, the report title, the filters used, the date and time it was generated (East Africa Time), who generated it, and "Page X of Y".

| Report | Who | Filters | Sort by |
| --- | --- | --- | --- |
| Revenue (`getRevenueReport`) | Admin | date range, payment method | date, amount, method, customer |
| Bookings (`getBookingReport`) | Receptionist, Admin | date range, status | start time, status, customer, bay |
| Job cards (`getJobReport`) | Receptionist, Admin, Mechanic (own jobs only) | date range, status, mechanic | opened, status, mechanic, customer |
| Outstanding invoices (`getOutstandingInvoicesReport`) | Receptionist, Admin | optional issue date range | issue date, balance, customer |
| Audit trail (`getAuditReport`) | Admin | date range, user, outcome | time, user, action |
| Invoice (`getInvoicePdf`) | Customer (own), Receptionist, Admin | — | — |

Use `from` and `to` (for example `2026-11-01T00:00:00+03:00`) to choose the period; the default is the last 30 days (7 for the audit report) and the longest period is 366 days. Use `sort` and `order=asc|desc` for ordering. Totals (revenue per method, booking counts per status, labour hours, outstanding balance) are printed at the end of each report.

Example: `GET /api/v1/reports/revenue?from=2026-11-01T00:00:00+03:00&method=MOBILE_MONEY&sort=amount&order=desc`

---

## 10. Audit trail

The system records, with the time, the user and a request reference:

- every successful change (creating, editing, cancelling, paying, and so on);
- every failed change attempt and why it failed (outcome **FAILURE**);
- successful and failed sign-ins, password resets and two-factor checks;
- every refused action (outcome **DENIED**);
- M-Pesa settlements and failures (shown as *System*);
- every report or invoice PDF generated.

Passwords, tokens and two-factor secrets are never written to the audit trail. Administrators can browse it (`listAuditEvents`) or print it (`getAuditReport`). The request reference matches the `X-Request-ID` shown with every error message, so a user's error report can be traced to the exact event.

---

## 11. Error messages and troubleshooting

Every error has a short code, a plain-language message and a request reference. Field problems list each field and what is wrong with it.

| Message / code | Meaning | What to do |
| --- | --- | --- |
| `VALIDATION_ERROR` — *Check the supplied fields.* | A field is missing, too long or in the wrong format. | Correct the fields listed in `details`. |
| `INVALID_CREDENTIALS` | Wrong email or password, or the account is disabled. | Retry, or use *Forgot password*. |
| `MFA_REQUIRED` | Two-factor is on for this account. | Enter the 6-digit code from your app. |
| `INVALID_OTP` | Code wrong, expired or already used. | Wait for the next code; check the phone's clock is set automatically. |
| `INVALID_RESET_TOKEN` | The reset link was used, replaced or is older than 30 minutes. | Request a new link. |
| `UNAUTHORIZED` — *The session is no longer valid.* | Signed out, expired, or your account changed. | Sign in again. |
| `FORBIDDEN` | Your role cannot do this. | Ask a receptionist or administrator. |
| `NOT_FOUND` | It does not exist, or it is not yours. | Check the number. |
| `BOOKING_CONFLICT` | The slot was just taken or the vehicle is booked then. | Choose another slot from availability. |
| `PRECONDITION_FAILED` | Someone else changed this record first. | Reload, then repeat your change. |
| `CONFLICT` | The action does not fit the record's current state (for example invoicing an unfinished job, or paying more than the balance). | Read the message; it says what is needed. |
| `RATE_LIMITED` | Too many sign-in attempts. | Wait 15 minutes. |
| `PAYMENT_PROVIDER_NOT_CONFIGURED` | M-Pesa is not set up on this server. | Pay at the front desk, or configure M-Pesa ([section 8](#8-payments-and-m-pesa)). |
| `PAYMENT_PROVIDER_ERROR` | M-Pesa could not send the prompt. | Check the phone number and try again. |
| `DATABASE_UNAVAILABLE` / `SCHEMA_NOT_READY` | The database is down or tables are missing. | Administrator: run `npm run db:check`, then `npm run db:init`. |

Server does not start? Run `npm run db:check`. Typical causes are a wrong password, MySQL not running, the wrong port, or `DB_SSL` settings (local MySQL usually needs `DB_SSL=false`; hosted MySQL needs `DB_SSL=true`).

---

## 12. Security summary

- Passwords are stored only as salted **scrypt** hashes, never in readable form.
- Optional **two-factor authentication** (TOTP); the shared secrets are **encrypted with AES-256-GCM** before they are stored.
- Password reset tokens are random, single-use, expire after 30 minutes and are stored only as SHA-256 hashes.
- All database statements use **prepared statements with bound values**, preventing SQL injection; table and column names come only from server code.
- Signed, short-lived session tokens that are revoked on logout, password change and role change.
- Sign-in and password reset are rate-limited; sign-in failures do not reveal whether an email exists.
- Role and ownership checks on every request; security headers (Helmet); restricted CORS; request size limits.
- M-Pesa results are confirmed directly with Safaricom before money is recorded; the callback address contains a secret token.
- A complete audit trail of who did what and when.
