import type { SystemStatus } from '@ghayarly/shared';
import type { FastifyInstance } from 'fastify';
import { integrationStatus } from '../../integrations/status';

export async function systemRoutes(app: FastifyInstance) {
  const { env, pools, messaging, payments } = app.services;

  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));

  app.get('/ready', { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      await pools.appPool.query('select 1');
      await pools.authPool.query('select 1');
      return { status: 'ready' };
    } catch {
      return reply.status(503).send({ status: 'unavailable' });
    }
  });

  app.get('/v1/system/status', async (): Promise<SystemStatus> => ({
    environment: env.NODE_ENV,
    demoMode: env.DEMO_MODE,
    integrations: integrationStatus(env, messaging, payments),
  }));
}
