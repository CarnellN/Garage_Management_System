// All backend calls go through api(). Matches docs/openapi.yaml.
const BASE = import.meta.env.VITE_API_URL || "/api/v1";
const KEY = "garage_session";

export const session = {
  get: () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
  set: (s) => localStorage.setItem(KEY, JSON.stringify(s)),
  clear: () => localStorage.removeItem(KEY),
};

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `Request failed (${status})`);
    this.status = status;
    this.code = body?.code;
    this.details = body?.details || [];
  }
}
export const errorText = (e) =>
  [e.message, ...(e.details || []).map((d) => `${d.field}: ${d.message}`)].join(" - ");

export async function api(path, { method = "GET", body, query, headers = {} } = {}) {
  const s = session.get();
  const url = new URL(`${BASE}${path}`, window.location.origin);
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v !== "" && v != null) url.searchParams.set(k, v);
  });

  const res = await fetch(url, {
    method,
    headers: {
      ...(body && { "Content-Type": "application/json" }),
      ...(s?.access_token && { Authorization: `Bearer ${s.access_token}` }),
      // Every create (POST) except auth needs a unique retry key
      ...(method === "POST" && !path.startsWith("/auth") && { "Idempotency-Key": crypto.randomUUID() }),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (res.status === 401 && s) { // session expired (they last 15 minutes) or revoked
      session.clear();
      window.dispatchEvent(new Event("auth-expired"));
    }
    throw new ApiError(res.status, data);
  }
  return res.status === 204 ? null : res.json();
}

// Lists are paginated (max 100 per page). This collects every page.
export async function fetchAll(path, query = {}) {
  const items = [];
  for (let page = 1; page <= 50; page++) {
    const r = await api(path, { query: { ...query, page, page_size: 100 } });
    items.push(...r.items);
    if (!r.items.length || items.length >= r.pagination.total) break;
  }
  return items;
}
