# Garage Management System - Client UI

A React front end for a garage management system, with a customer portal and an admin portal. It talks to the Express API in `backend/server`, which stores data in MySQL.

## Requirements

- [Node.js](https://nodejs.org) 22 or newer (the backend requires 22+)
- npm (comes with Node.js)
- The backend API running locally, with the database created and seeded. See the [server README](../backend/server/README.md) and the [database README](../backend/database/README.md).

Check your versions:

```bash
node -v
npm -v
```

## Getting started

1. Start the backend first. From `backend/server`, run `npm run dev`. It listens on `http://127.0.0.1:8000`. Make sure `JWT_SECRET` is set in `backend/server/.env.local`, or every login fails with "Authentication is not configured on this server."
2. From inside the `client` folder:

   ```bash
   npm install
   npm run dev
   ```

3. Open the link printed in the terminal (usually http://localhost:5173).

In development, Vite forwards every request under `/api` to `http://127.0.0.1:8000` (see `vite.config.js`), so the browser does not hit CORS errors. To use an API at another address, set `VITE_API_URL` (for example `VITE_API_URL=https://api.example.com/api/v1`) before building or starting the dev server. That origin must then be listed in the server's `CORS_ORIGINS`.

## Logging in

All seeded accounts use the password `Password123!`.

| Portal | Login page | Allowed roles | Seeded account |
|---|---|---|---|
| Customer | `/customer-login` | `CUSTOMER` | `james.mwangi@example.com` (3 vehicles, history, upcoming appointments) |
| Admin | `/admin-login` | `ADMIN`, `RECEPTIONIST` | `sarah.njeri@garage.local` or `esther.achieng@garage.local` (admin), `john.kipchoge@garage.local` (receptionist) |

The [database README](../backend/database/README.md#seed-data-credentials) lists every seeded account and what each one is useful for demoing.

New customers can create an account at `/register` and are logged in straight away.

### How portal access works

- `PORTAL_ROLES` in `src/lib/auth.jsx` maps each portal to the roles it accepts. If an account signs in at the wrong portal, the client logs it straight out and shows "This account cannot use the ... portal."
- `PortalLayout` redirects anyone without an allowed role back to that portal's login page, so typing `/admin` in the address bar does not get a customer in.
- These checks only control what the browser shows. The server enforces roles and ownership on every request, so a customer cannot reach admin data even by calling the API directly. See [Roles and access](../backend/server/README.md#roles-and-access).
- The session (access token and user) is stored in `localStorage` under `garage_session`. Tokens expire after 15 minutes by default, and you are then sent back to the login page.

### Known limitations

- **Receptionists:** they can use the admin portal, but creating, editing and deleting service tasks is admin-only on the server. On the Services page those buttons are shown to receptionists, and using them returns "Your role cannot perform this action."
- **Mechanics:** mechanic accounts are rejected by both portals ("Mechanic accounts are not supported in this app yet."), although the API supports them.
- **Service history:** the backend has no history endpoint, so the customer History page is built from issued invoices and their job cards (`src/lib/history.js`).

## Routes

| Path | Screen |
|---|---|
| `/` | Welcome page |
| `/customer-login` | Customer login |
| `/admin-login` | Admin login |
| `/register` | Customer registration |
| `/customer` | Customer dashboard |
| `/customer/vehicles` | Manage vehicles |
| `/customer/book` | Book appointment |
| `/customer/history` | Service history |
| `/admin` | Admin dashboard |
| `/admin/appointments` | Appointment management |
| `/admin/customers` | Manage customers |
| `/admin/services` | Service management |

## Project structure

```
client/src/
├── main.jsx                   Entry point
├── App.jsx                    Routes
├── components/
│   ├── Async.jsx              Loading / error wrapper for API data
│   └── Card.jsx               Reusable card
├── hooks/useApi.js            Loads API data, with loading, error and reload
├── layouts/PortalLayout.jsx   Header, nav and footer; blocks users without an allowed role
├── lib/
│   ├── api.js                 api() fetch wrapper, session storage, error formatting
│   ├── auth.jsx               Login, logout, registration and PORTAL_ROLES
│   ├── history.js             Builds service history from invoices
│   └── format.js              Currency formatting (KES)
├── pages/
│   ├── Public.jsx             Welcome, logins, registration
│   ├── Customer.jsx           Customer screens
│   └── Admin.jsx              Admin screens
└── styles/styles.css          All styling
```

All API calls go through `api()` in `src/lib/api.js`, which matches `docs/openapi.yaml`. See [docs/FRONTEND_API.md](../docs/FRONTEND_API.md) for the API integration guide.

## Other commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Create a production build in `dist/` |
| `npm run preview` | Preview the production build locally |

## Troubleshooting

- **"Authentication is not configured on this server."**: `JWT_SECRET` is empty in `backend/server/.env.local`. Set it and restart the backend.
- **"Email or password is incorrect." with a seeded account and `Password123!`**: the database may still have old bcrypt password hashes. See [Password hash format](../backend/database/README.md#password-hash-format).
- **"This account cannot use the ... portal."**: you are signing in at the wrong portal for that account's role. See [Logging in](#logging-in).
- **"Too many authentication attempts."**: the server allows 30 login attempts per 15 minutes. Wait, or restart the backend in development.
- **Every request fails and the Vite terminal shows `http proxy error` / `ECONNREFUSED`**: the backend is not running on port 8000. Start it with `npm run dev` in `backend/server`.
- **`Failed to resolve import "./something"`**: an import path does not match the file's location. Check it against the project structure above.
- **Page looks unstyled**: make sure `src/styles/styles.css` exists and `main.jsx` imports it.
- **`npm` is not recognized**: install Node.js, then reopen your terminal.
- **Port already in use**: Vite will offer another port, or stop the other process using port 5173. If you use a port other than 5173, add it to the server's `CORS_ORIGINS`.
