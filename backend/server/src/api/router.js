import { createHash } from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createStore } from './sql.js';
import { contract, operations, validateRequest } from './contract.js';
import { createSecurity, assertAccount } from './security.js';
import { assertSession, utcDate } from './sessions.js';
import { authHandlers } from './auth-handlers.js';
import { resourceHandlers } from './resources.js';
import { workflowHandlers } from './workflows.js';
import { paymentHandlers } from './payments.js';
import { reportHandlers } from './reports.js';
import { createCipher } from './mfa.js';
import { createMailer } from '../services/mailer.js';
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
      await assertSession(store, current, req.sessionId);
    }
    const key = req.input.headers['Idempotency-Key'];
    const canonicalPath = `/api/v1${req.operation.path.replace(/\{(\w+)\}/g, (_, name) => String(req.input.params[name]))}`;
    const filter = key ? { user_id: req.user.user_id, http_method: req.method, path: canonicalPath, key } : null;
    const fingerprint = createHash('sha256').update(canonical(req.body ?? {})).digest('hex');
    if (key) {
      const cached = await store.find('IDEMPOTENCY_KEY', filter, { lock: true });
      // Official MySQL collation is case/accent insensitive. Never replay a different exact key/path.
      if (cached && (cached.key !== key || cached.path !== canonicalPath || cached.http_method !== req.method)) {
        throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This key collides with another stored key under the database collation. Use a new unique key.');
      }
      if (cached && utcDate(cached.expires_at).getTime() > Date.now()) {
        if (cached.request_fingerprint !== fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This key was already used with a different request.');
        const saved = typeof cached.response_body === 'string' ? JSON.parse(cached.response_body) : cached.response_body;
        if (!saved || !cached.response_status) throw new HttpError(409, 'IDEMPOTENCY_PENDING', 'This retry record has no completed response. Reconcile before retrying.');
        return { status: cached.response_status, body: saved.body, headers: saved.headers };
      }
      if (cached) await store.remove('IDEMPOTENCY_KEY', filter);
    }
    const result = await handler(req, store);
    await audit(store, req, 'SUCCESS');
    if (key) await store.insert('IDEMPOTENCY_KEY', { ...filter, request_fingerprint: fingerprint, response_status: result.status ?? 200, response_body: JSON.stringify({ body: result.body, headers: result.headers ?? {} }), created_at: new Date(), expires_at: new Date(Date.now() + 86400000) });
    return result;
  });
}

const PUBLIC_RATE_LIMITED = ['login', 'registerCustomer', 'requestPasswordReset', 'resetPassword'];

export function createApiRouter({ database, auth = {}, workflows, logger = console, extraHandlers = {}, mpesa, mailer, company, appBaseUrl, dataEncryptionKey }) {
  const router = Router();
  const security = createSecurity(database, auth);
  const cipher = createCipher({ dataKey: dataEncryptionKey, jwtSecret: auth.secret });
  const handlers = {
    ...authHandlers(database, security, { cipher, mailer: mailer ?? createMailer({}, logger), appBaseUrl, issuer: company?.name, logger }),
    ...resourceHandlers(), ...workflowHandlers(workflows), ...paymentHandlers({ database, mpesa, logger }),
    ...reportHandlers({ company, logger }), ...extraHandlers,
  };
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    handler(req, res) { res.status(429).json({ code: 'RATE_LIMITED', message: 'Too many authentication attempts. Try again later.', request_id: req.requestId }); },
  });
  router.get('/', (req, res) => res.json({ name: contract.info.title, version: contract.info.version, docs: '/api/docs', contract: '/api/openapi.json', operations: operations.map((operation) => {
    const requiresPaymentProvider = ['createPaymentIntent', 'refreshPaymentIntent'].includes(operation.operationId);
    return { operationId: operation.operationId, method: operation.method.toUpperCase(), path: `/api/v1${operation.path}`, implemented: Boolean(handlers[operation.operationId]) && (!requiresPaymentProvider || Boolean(mpesa?.configured)), requiresPaymentProvider };
  }) }));
  for (const operation of operations) {
    const path = operation.path.replace(/\{(\w+)\}/g, ':$1');
    const validate = validateRequest(operation);
    const authenticate = operation.security?.length === 0 ? false : true;
    const middleware = PUBLIC_RATE_LIMITED.includes(operation.operationId) ? [limiter] : [];
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
        // Work that must not hold database locks (email, payment provider calls) runs after commit.
        if (result.afterCommit) Object.assign(result, await result.afterCommit() ?? {});
        if (result.headers) res.set(result.headers);
        if (result.raw) return res.status(result.status ?? 200).send(result.raw);
        if (result.status === 204) return res.status(204).end();
        return res.status(result.status ?? 200).json(result.body);
      } catch (error) {
        // Failed logins, denials and every failed change are kept in the audit trail.
        if (PUBLIC_RATE_LIMITED.includes(operation.operationId) || [401, 403].includes(error.status) || operation.method !== 'get') {
          try { await audit(createStore(database), req, error.status === 403 ? 'DENIED' : 'FAILURE'); }
          catch { logger.error({ event: 'audit_write_failed', request_id: req.requestId }); }
        }
        next(error);
      }
    });
  }
  return router;
}
