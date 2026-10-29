import { randomBytes, randomUUID, scrypt as rawScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';
import { HttpError } from '../errors.js';
import { createStore } from './sql.js';
import { project } from './contract.js';
import { saveSession, assertSession } from './sessions.js';

const scrypt = promisify(rawScrypt);
const passwordOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64, passwordOptions);
  return `scrypt$32768$8$1$${salt}$${hash.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  const valid = parts.length === 6 && parts.slice(0, 4).join('$') === 'scrypt$32768$8$1' && /^[a-f0-9]{32}$/.test(parts[4]) && /^[a-f0-9]{128}$/.test(parts[5]);
  // Equal work for missing accounts prevents the obvious account-enumeration timing difference.
  const hash = await scrypt(password, valid ? parts[4] : '0'.repeat(32), 64, passwordOptions);
  return valid && timingSafeEqual(hash, Buffer.from(parts[5], 'hex'));
}
export function publicUser(user) { return project('User', user); }
export function assertAccount(user) {
  if (!user || !(user.active === true || user.active === 1) || !['CUSTOMER', 'RECEPTIONIST', 'MECHANIC', 'ADMIN'].includes(user.role) ||
      (user.role === 'CUSTOMER' ? !user.customer_id : user.customer_id != null)) {
    throw new HttpError(401, 'UNAUTHORIZED', 'The session is no longer valid.');
  }
}
export function createSecurity(database, config = {}) {
  const key = config.secret ? new TextEncoder().encode(config.secret) : null;
  const issuer = config.issuer ?? 'garage-management-api';
  const audience = config.audience ?? 'garage-frontend';
  const ttl = config.ttl ?? 900;
  const configured = () => {
    if (!key || key.length < 32) throw new HttpError(503, 'AUTH_NOT_CONFIGURED', 'Authentication is not configured on this server.');
  };
  return {
    configured,
    async session(store, user) {
      configured();
      assertAccount(user);
      const id = randomUUID();
      await saveSession(store, user, id, ttl);
      const access_token = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setSubject(String(user.user_id)).setJti(id)
        .setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime(`${ttl}s`).sign(key);
      return { access_token, token_type: 'Bearer', expires_in: ttl, user: publicUser(user) };
    },
    async authenticate(req) {
      const header = req.get('Authorization');
      if (!header || !/^Bearer \S+$/i.test(header)) throw new HttpError(401, 'UNAUTHORIZED', 'Supply a valid bearer token.');
      configured();
      let payload;
      try {
        ({ payload } = await jwtVerify(header.slice(7), key, { algorithms: ['HS256'], issuer, audience, requiredClaims: ['sub', 'jti', 'iat', 'exp'] }));
        if (!/^[1-9]\d*$/.test(payload.sub) || Number(payload.sub) > 2147483647 || typeof payload.jti !== 'string') throw new Error('Invalid subject.');
      } catch { throw new HttpError(401, 'UNAUTHORIZED', 'The bearer token is invalid or expired.'); }
      const store = createStore(database);
      const user = await store.find('USER', { user_id: Number(payload.sub) });
      assertAccount(user);
      await assertSession(store, user, payload.jti);
      req.user = publicUser(user);
      req.sessionId = payload.jti;
    },
  };
}
