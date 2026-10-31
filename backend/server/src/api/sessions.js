import { createHash } from 'node:crypto';
import { HttpError } from '../errors.js';

// The official schema has no auth_session table. Reserve a non-HTTP method/path
// namespace in its durable, expiring key store; normal API retry records cannot collide.
const scope = { http_method: 'SESSION', path: '/api/v1/auth/sessions' };
const fingerprint = (user) => createHash('sha256').update(JSON.stringify([
  user.user_id, user.role, user.customer_id ?? null, Boolean(user.active), user.password_hash,
])).digest('hex');
export const utcDate = (value) => value instanceof Date ? value : new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);

export async function saveSession(store, user, id, ttl) {
  const now = Math.floor(Date.now() / 1000) * 1000;
  await store.insert('IDEMPOTENCY_KEY', {
    ...scope, user_id: user.user_id, key: id, request_fingerprint: fingerprint(user),
    response_status: null, response_body: null,
    created_at: new Date(now), expires_at: new Date(now + ttl * 1000),
  });
}
export async function assertSession(store, user, id) {
  const row = await store.find('IDEMPOTENCY_KEY', { ...scope, user_id: user.user_id, key: id });
  if (!row || row.key !== id || row.request_fingerprint !== fingerprint(user) || utcDate(row.expires_at).getTime() <= Date.now()) {
    throw new HttpError(401, 'UNAUTHORIZED', 'The session is no longer valid.');
  }
}
export async function revokeSession(store, userId, id) {
  await store.remove('IDEMPOTENCY_KEY', { ...scope, user_id: userId, key: id });
}
export async function revokeUserSessions(store, userId) {
  await store.remove('IDEMPOTENCY_KEY', { ...scope, user_id: userId });
}
