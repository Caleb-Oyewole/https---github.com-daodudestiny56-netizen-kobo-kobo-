import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance } from 'fastify';
import { AppError } from './errors';
import type { Deps } from './deps';
import { serviceAuth } from './http/auth';
import { pfaRoutes } from './routes/pfa';
import { splitRoutes } from './routes/split';
import { sweepRoutes } from './routes/sweeps';

export function buildServer(deps: Deps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(formbody);

  app.setErrorHandler((err: Error, _req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({ error: { code: 'BAD_REQUEST', message: err.message } });
    }
    console.error('[http] unhandled error', err);
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Internal error' } });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));

  app.get('/health', async () => ({ status: 'ok' }));

  // Internal API: Rails and ops call these with the service token.
  app.register(async (internal) => {
    internal.addHook('preHandler', serviceAuth(deps.config.serviceToken));
    splitRoutes(internal, deps);
    pfaRoutes(internal, deps);
    sweepRoutes(internal, deps);
  });

  return app;
}
