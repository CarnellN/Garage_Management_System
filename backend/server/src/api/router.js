import { createHash } from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createStore } from './sql.js';
import { contract, operations, validateRequest } from './contract.js';
import { createSecurity, assertAccount, utcDate } from './security.js';
import { authHandlers } from './auth-handlers.js';
import { resourceHandlers } from './resources.js';
import { workflowHandlers } from './workflows.js';
import { HttpError } from '../errors.js';

const canonical = (value) => JSON.stringify(value, (key, entry) => entry && !Array.isArray(entry) && typeof entry === 'object'
  ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
async function audit(store, req, outcome) {
  await store.insert('AUDIT_EVENT', {
    actor_user_id: req.user?.user_id ?? req.auditActorId ?? null,
    action: req.operation.operationId, resource_type: req.operation.tags[0],
    resource_id: Object.values(req.input?.params ?? {})[0]?.toString() ?? null,
    occurred_at: new Date(), request_id: req.requestId, outcome,
  });
}
async function mutate(database, req, handler) {
  return database.transaction(async (tx) => {
    const store = createStore(tx);
    if (req.user) {
      const current = await store.find('USER', { user_id: req.user.user_id }, { lock: true });
      assertAccount(current);
      if (current.role !== req.user.role || Number(current.customer_id) !== Number(req.user.customer_id)) throw new HttpError(401, 'UNAUTHORIZED', 'Your account has changed. Log in again.');
      const session = await store.find('AUTH_SESSION', { session_id: req.sessionId, user_id: req.user.user_id });
      if (!session || session.revoked_at || utcDate(session.expires_at).getTime() <= Date.now()) throw new HttpError(401, 'UNAUTHORIZED', 'The session is no longer valid.');
    }
    const key = req.input.headers['Idempotency-Key'];
    const canonicalPath = `/api/v1${req.operation.path.replace(/\{(\w+)\}/g, (_, name) => String(req.input.params[name]))}`;
    const filter = key ? { user_id: req.user.user_id, method: req.method, path: canonicalPath, key } : null;
    const fingerprint = createHash('sha256').update(canonical(req.body ?? {})).digest('hex');
    if (key) {
      const cached = await store.find('IDEMPOTENCY_KEY', filter, { lock: true });
      if (cached && utcDate(cached.expires_at).getTime() > Date.now()) {
        if (cached.request_hash !== fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This key was already used with a different request.');
        return typeof cached.response_json === 'string' ? JSON.parse(cached.response_json) : cached.response_json;
      }
      if (cached) await store.remove('IDEMPOTENCY_KEY', filter);
    }
    const result = await handler(req, store);
    await audit(store, req, 'SUCCESS');
    if (key) await store.insert('IDEMPOTENCY_KEY', { ...filter, request_hash: fingerprint, response_json: JSON.stringify(result), created_at: new Date(), expires_at: new Date(Date.now() + 86400000) });
    return result;
  });
}

export function createApiRouter({ database, auth, workflows, logger = console, extraHandlers = {} }) {
  const router = Router();
  const security = createSecurity(database, auth);
  const handlers = { ...authHandlers(database, security), ...resourceHandlers(), ...workflowHandlers(workflows), ...extraHandlers };
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    handler(req, res) { res.status(429).json({ code: 'RATE_LIMITED', message: 'Too many authentication attempts. Try again later.', request_id: req.requestId }); },
  });
  router.get('/', (req, res) => res.json({ name: contract.info.title, version: contract.info.version, docs: '/api/docs', contract: '/api/openapi.json', operations: operations.map((operation) => {
    const requiresPaymentProvider = ['createPaymentIntent','getPaymentIntent'].includes(operation.operationId);
    return { operationId: operation.operationId, method: operation.method.toUpperCase(), path: `/api/v1${operation.path}`, implemented: Boolean(handlers[operation.operationId]) && !requiresPaymentProvider, requiresPaymentProvider };
  }) }));
  for (const operation of operations) {
    const path = operation.path.replace(/\{(\w+)\}/g, ':$1');
    const validate = validateRequest(operation);
    const authenticate = operation.security?.length === 0 ? false : true;
    const middleware = ['login', 'registerCustomer'].includes(operation.operationId) ? [limiter] : [];
    router[operation.method](path, ...middleware, async (req, res, next) => {
      req.operation = operation;
      try {
        if (authenticate) {
          await security.authenticate(req);
          if (!operation['x-roles'].includes(req.user.role)) throw new HttpError(403, 'FORBIDDEN', 'Your role cannot perform this action.');
        }
        await new Promise((resolve, reject) => validate(req, res, (error) => error ? reject(error) : resolve()));
        const handler = handlers[operation.operationId];
        if (!handler) throw new HttpError(501, 'NOT_IMPLEMENTED', 'This workflow is not available yet. Check /api/v1 for implementation status.');
        const result = operation.method === 'get' ? await handler(req, createStore(database)) : await mutate(database, req, handler);
        if (result.headers) res.set(result.headers);
        if (result.status === 204) return res.status(204).end();
        return res.status(result.status ?? 200).json(result.body);
      } catch (error) {
        if (['login', 'registerCustomer'].includes(operation.operationId) || [401, 403].includes(error.status)) {
          try { await audit(createStore(database), req, error.status === 403 ? 'DENIED' : 'FAILURE'); }
          catch { logger.error({ event: 'audit_write_failed', request_id: req.requestId }); }
        }
        next(error);
      }
    });
  }
  return router;
}
