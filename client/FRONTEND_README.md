# Garage Management System - Client UI

A React front end for a garage management system, with a customer portal and an admin portal.

> **Current stage:** UI prototype only. There is no backend or database yet. All data is sample data held in memory and resets when the page is refreshed. Login accepts any email and password.

## Requirements

- [Node.js](https://nodejs.org) 18 or newer (LTS recommended)
- npm (comes with Node.js)

Check your versions:

```bash
node -v
npm -v
```

## Getting started

From inside the `client` folder:

```bash
npm install
npm install react-router-dom
npm run dev
```

Open the link printed in the terminal (usually http://localhost:5173).

## Using the app

| To see | Do this |
|---|---|
| Customer screens | Click **Customer Portal**, enter any email and password, click **Login** |
| Admin screens | Click **Admin Portal**, enter any email and password, click **Login** |
| Registration | Click **Register New Customer** on the welcome page |

Use **Logout** in the top navigation bar to switch between portals.

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
├── main.jsx               Entry point
├── App.jsx                Routes
├── components/Card.jsx    Reusable card
├── layouts/PortalLayout.jsx   Header, nav and footer for both portals
├── lib/
│   ├── store.jsx          Sample data and add/edit/delete functions
│   └── format.js          Currency formatting (KES)
├── pages/
│   ├── Public.jsx         Welcome, logins, registration
│   ├── Customer.jsx       Customer screens
│   └── Admin.jsx          Admin screens
└── styles/styles.css      All styling
```

## Other commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Create a production build in `dist/` |
| `npm run preview` | Preview the production build locally |

## Troubleshooting

- **`Failed to resolve import "react-router-dom"`**: run `npm install react-router-dom` inside the `client` folder.
- **`Failed to resolve import "./something"`**: an import path does not match the file's location. Check it against the project structure above.
- **Page looks unstyled**: make sure `src/styles/styles.css` exists and `main.jsx` imports it.
- **`npm` is not recognized**: install Node.js, then reopen your terminal.
- **Port already in use**: Vite will offer another port, or stop the other process using port 5173.
