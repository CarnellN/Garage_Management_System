import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { HttpError, errorHandler } from './errors.js';
import swaggerUi from 'swagger-ui-express';
import { contract } from './api/contract.js';
import { createApiRouter } from './api/router.js';

export function createApp({ database, corsOrigins = [], auth, workflows, logger = console, extraHandlers }) {
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
  app.use(cors((req, optionsCallback) => optionsCallback(null, {
    origin(origin, callback) {
      const sameOrigin = origin === `${req.protocol}://${req.get('host')}`;
      if (!origin || sameOrigin || corsOrigins.includes(origin)) return callback(null, true);
      return callback(new HttpError(403, 'ORIGIN_FORBIDDEN', 'This origin is not permitted.'));
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'If-Match', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-ID', 'ETag', 'Location', 'Retry-After'],
    maxAge: 600,
  })));
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

  app.get('/api/openapi.json', (req, res) => res.json(contract));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(contract, { swaggerOptions: { persistAuthorization: false } }));
  app.use('/api/v1', createApiRouter({ database, auth, workflows, logger, extraHandlers }));
  app.use((req, res, next) => next(new HttpError(404, 'NOT_FOUND', 'The requested endpoint does not exist.')));
  app.use(errorHandler(logger));
  return app;
}
