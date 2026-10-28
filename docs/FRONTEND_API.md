# Frontend API integration

Server source: `backend/server`. Start it from that directory with `npm run dev`. Default API base URL: `http://localhost:8000/api/v1`. Configure `CORS_ORIGINS` for the frontend's exact origin. MySQL is the default; Supabase/PostgreSQL is selectable with `DB_CLIENT=postgres`.

While the server is running:

- `GET /api/v1` lists the operation IDs, paths and implementation status.
- `/api/docs` opens Swagger UI with request bodies, parameters and response schemas. Use **Authorize** to supply an access token.
- `/api/openapi.json` returns the same contract as [openapi.yaml](openapi.yaml).
- `/health` checks liveness; `/health/ready` checks database connectivity, not schema readiness.

53 operations have server handlers for authentication, staff, customers, vehicles, scheduling, job work, catalogs, invoices, settled payments and audit reads. The two online payment-intent operations return `503 PAYMENT_PROVIDER_NOT_CONFIGURED` until a provider adapter is implemented. Staff can record completed cash or manually verified non-cash payments. A browser cannot declare a payment settled.

The database developer must provision the shared tables and the [integration fields](../backend/database/README.md). Missing tables/columns return `503 SCHEMA_NOT_READY`. Missing JWT secret, opening-hours configuration or labor rate return a specific configuration error. No migrations run on startup. HTTP tests use database doubles; live SQL execution and concurrent booking/payment behavior still require testing against the provisioned schema.

## Shared client

Copy [api-client.mjs](api-client.mjs) and [api-operations.json](api-operations.json) together into the frontend source, or import them from this repository if the frontend build permits it. The client uses `fetch`, has no runtime package dependency, and exports one method for each OpenAPI operation ID. JSON import attributes require a modern browser/build tool. The frontend can also call the endpoints with its own fetch/Axios wrapper.

```js
import { createGarageClient, GarageApiError } from './api-client.mjs';

let accessToken = null; // Keep bearer tokens in memory; reauthenticate after expiration.
const api = createGarageClient({
  baseUrl: 'http://localhost:8000/api/v1',
  getToken: () => accessToken,
});

const { data: session } = await api.login({
  body: { email: 'jane@example.com', password: 'your-password' },
});
accessToken = session.access_token;
const customerId = session.user.customer_id;

const createKey = crypto.randomUUID();
const { data: vehicle } = await api.createVehicle({
  body: { customer_id: customerId, registration_no: 'KDA 123A', make: 'Toyota', model: 'Corolla' },
  idempotencyKey: createKey,
});
const { data: page } = await api.listVehicles({ query: { page: 1, page_size: 20 } });
console.log(page.items, page.pagination.total);

await api.logout();
accessToken = null;
```

For registration, call `registerCustomer` with `name`, `email`, `password` (12–128 characters) and optional nullable `phone`. The server creates the CUSTOMER role and customer link; never send `role`, `user_id` or `customer_id` during registration. Accounts created as contact profiles by receptionists do not automatically acquire login access.

All client methods accept `{ path, query, body, idempotencyKey, etag, signal }` and return `{ data, etag, location, requestId }`. GET parameters belong in `query`; resource IDs belong in `path` using the exact OpenAPI parameter names. The client does not retry, persist tokens, or refresh sessions automatically. Abort/network failures propagate as fetch errors.

## Booking and job concurrency

```js
const { data: slots } = await api.listAvailability({
  query: {
    from: '2027-01-04T08:00:00+03:00',
    to: '2027-01-05T17:00:00+03:00',
    duration_minutes: 60,
    vehicle_id: vehicle.vehicle_id,
  },
});
const slot = slots.items[0]; // Handle an empty result in the UI.
const { data: booking } = await api.createBooking({
  body: { vehicle_id: vehicle.vehicle_id, scheduled_at: slot.scheduled_at, ends_at: slot.ends_at },
  idempotencyKey: crypto.randomUUID(),
});
const current = await api.getBooking({ path: { bookingId: booking.booking_id } });
await api.updateBookingStatus({
  path: { bookingId: booking.booking_id }, body: { status: 'CANCELLED' }, etag: current.etag,
});
```

Availability is advisory; creation may return `409 BOOKING_CONFLICT`. Booking and job mutations require the strong `ETag` from the latest GET, supplied verbatim as `If-Match`. Task/part mutations use the parent job card's ETag and return its new ETag. On `412`, refetch and let the user reconcile; on `428`, supply the missing ETag. Opening hours and future appointment checks run on the server. Date-time requests require an explicit UTC offset; responses use UTC `Z`.

For operations requiring `Idempotency-Key`, generate a key per logical creation/payment, retain it until the outcome is known, and reuse it with the identical body when recovering from a network failure. The server retains successful responses for at least 24 hours. Do not generate a fresh key when retrying an uncertain payment. Changing the body under the same key returns 409. There are no automatic online payment retries or unverified settlement paths.

## Data and errors

Money and standard hours are decimal strings (`"1500.00"`, `"1.50"`), not JavaScript numbers. Currency is KES. Invoice totals, line prices, payment timestamps and account roles are server-controlled. `PATCH` sends only changed fields; use explicit null only where the schema permits it. Lists return `{ items, pagination: { page, page_size, total } }`, with a maximum page size of 100. User roles and customer/mechanic scope are enforced by the server, including list totals.

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Check the supplied fields.",
  "request_id": "server-generated-id",
  "details": [{ "field": "registration_no", "message": "must have required property" }]
}
```

`GarageApiError` exposes `status`, `code`, `details`, `requestId` and `retryAfter`. Show field errors for 422, prompt login for 401, hide forbidden actions for 403, show unavailable resources for 404, and handle conflicts without silently overwriting user work. A 503 can indicate database/configuration readiness; show an availability message and preserve unsent form data. Share `requestId` when reporting a server problem. A timeout does not prove a write failed.

Customer: owned profiles/vehicles/bookings/invoices/receipts; read-only owned job details. Receptionist: customer intake, scheduling, job assignment, invoicing and payment recording. Mechanic: assigned job cards, tasks and parts. Admin: staff, catalogs, operations and audit trail. Consult each operation's `x-roles` in the contract for exact permissions.
