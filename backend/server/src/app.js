import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { HttpError, errorHandler } from './errors.js';

export function createApp({ database, corsOrigins = [], logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  // Leave proxy trust disabled until the deployment's exact proxy topology is known.
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set('X-Request-ID', req.requestId);
    res.set('Cache-Control', 'no-store');
    const started = performance.now();
    res.on('finish', () => {
      logger.info({
        event: 'request_completed', request_id: req.requestId, method: req.method,
        status: res.statusCode, duration_ms: Math.round(performance.now() - started),
      });
    });
    next();
  });
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.includes(origin)) return callback(null, true);
      return callback(new HttpError(403, 'ORIGIN_FORBIDDEN', 'This origin is not permitted.'));
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'If-Match', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-ID', 'ETag', 'Location', 'Retry-After'],
    maxAge: 600,
  }));
  app.use(express.json({ limit: '100kb', strict: true }));

  // Infrastructure probes are outside the versioned business API and expose no credentials.
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', async (req, res) => {
    try {
      await database.check();
    } catch {
      throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'The database is temporarily unavailable.');
    }
    res.json({ status: 'ok', database: 'connected' });
  });

  // Business routes will be mounted at /api/v1 as their auth and data layers are built.
  app.use((req, res, next) => next(new HttpError(404, 'NOT_FOUND', 'The requested endpoint does not exist.')));
  app.use(errorHandler(logger));
  return app;
}
