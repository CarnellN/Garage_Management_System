import { HttpError } from '../errors.js';
import { hashPassword, verifyPassword, publicUser } from './security.js';
import { reply, invalid } from './resources.js';
import { revokeSession } from './sessions.js';

export function authHandlers(database, security) {
  return {
    async registerCustomer(req, store) {
      security.configured();
      const name = req.body.name.trim();
      const email = req.body.email.trim().toLowerCase();
      if (!name) invalid('Name must not be blank.');
      const password_hash = await hashPassword(req.body.password);
      const customer_id = await store.insert('CUSTOMER', { name, email, phone: req.body.phone ?? null }, 'customer_id');
      const user_id = await store.insert('USER', { name, email, password_hash, customer_id, role: 'CUSTOMER', active: true }, 'user_id');
      const user = await store.find('USER', { user_id });
      req.auditActorId = user_id;
      return reply(await security.session(store, user), 201, { Location: '/api/v1/auth/me' });
    },
    async login(req, store) {
      security.configured();
      const email = req.body.email.trim().toLowerCase();
      const user = await store.find('USER', { email });
      const matches = await verifyPassword(req.body.password, user?.password_hash);
      if (!matches || !user?.active) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
      const locked = await store.find('USER', { user_id: user.user_id }, { lock: true });
      if (!locked?.active || locked.password_hash !== user.password_hash) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
      req.auditActorId = user.user_id;
      return reply(await security.session(store, locked));
    },
    async getCurrentUser(req) { return reply(publicUser(req.user)); },
    async logout(req, store) {
      await revokeSession(store, req.user.user_id, req.sessionId);
      return reply(null, 204);
    },
  };
}
