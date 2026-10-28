// Browser/Node fetch client. The operation names match operationId in openapi.yaml.
import operations from './api-operations.json' with { type: 'json' };

export class GarageApiError extends Error {
  constructor(message, { status, code, requestId, details, retryAfter } = {}) {
    super(message);
    Object.assign(this, { name: 'GarageApiError', status, code, requestId, details, retryAfter });
  }
}

export function createGarageClient({ baseUrl = 'http://localhost:8000/api/v1', getToken = () => null, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  const client = {};
  for (const [name, operation] of Object.entries(operations)) {
    client[name] = async ({ path = {}, query = {}, body, idempotencyKey, etag, signal } = {}) => {
      const route = operation.path.replace(/\{(\w+)\}/g, (_, key) => {
        if (path[key] == null) throw new Error(`Missing path parameter: ${key}`);
        return encodeURIComponent(path[key]);
      });
      const url = new URL(`${baseUrl.replace(/\/$/, '')}${route}`);
      for (const [key, value] of Object.entries(query)) if (value != null) url.searchParams.set(key, String(value));
      const headers = { Accept: 'application/json' };
      const token = await getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
      if (etag) headers['If-Match'] = etag;
      for (const header of operation.headers) if (!headers[header]) throw new Error(`${header} is required for ${name}.`);
      const response = await fetchImpl(url, { method: operation.method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal });
      let data = null;
      if (response.status !== 204) {
        try { data = await response.json(); }
        catch { throw new GarageApiError('The server returned an invalid JSON response.', { status: response.status, requestId: response.headers.get('X-Request-ID') }); }
      }
      if (!response.ok) throw new GarageApiError(data?.message ?? 'The API request failed.', {
        status: response.status, code: data?.code, details: data?.details, requestId: data?.request_id ?? response.headers.get('X-Request-ID'), retryAfter: response.headers.get('Retry-After'),
      });
      return { data, etag: response.headers.get('ETag'), location: response.headers.get('Location'), requestId: response.headers.get('X-Request-ID') };
    };
  }
  return Object.freeze(client);
}
