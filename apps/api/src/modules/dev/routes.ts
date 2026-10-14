import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/validate';

/**
 * Developer tools. Registered only when DEV_TOOLS_ENABLED=true and NODE_ENV !== production
 * (the config loader also refuses to boot production with dev tools enabled).
 */
export async function devRoutes(app: FastifyInstance) {
  const { messaging } = app.services;

  app.get('/outbox', async (request) => {
    const query = parse(z.object({ to: z.string().optional(), purpose: z.string().optional() }), request.query);
    return {
      notice: 'Development outbox — these messages were NOT delivered to any real phone or inbox.',
      messages: messaging.outbox?.list(query) ?? [],
    };
  });
}
