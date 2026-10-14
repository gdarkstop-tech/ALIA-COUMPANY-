import type { NursingService } from '@ghayarly/shared';
import { asc } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { nursingServices } from '../../db/schema';
import { inContext, requirePrincipal } from '../../lib/principal';

export function serviceToDto(s: typeof nursingServices.$inferSelect): NursingService {
  return {
    id: s.id,
    code: s.code,
    nameAr: s.nameAr,
    nameEn: s.nameEn,
    descriptionAr: s.descriptionAr,
    descriptionEn: s.descriptionEn,
    scopeAr: s.scopeAr,
    scopeEn: s.scopeEn,
    durationMinutes: s.durationMinutes,
    basePricePiasters: s.basePricePiasters,
    requiresClinicalAuthorization: s.requiresClinicalAuthorization,
    isDemo: s.isDemo,
  };
}

export async function serviceRoutes(app: FastifyInstance) {
  app.get('/services', async (request) => {
    const principal = await requirePrincipal(request);
    const rows = await inContext(request, principal, (tx) => tx.select().from(nursingServices).orderBy(asc(nursingServices.sortOrder)));
    return rows.filter((s) => s.active).map(serviceToDto);
  });
}
