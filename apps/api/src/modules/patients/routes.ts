import {
  ageInYears,
  createHealthEntryBody,
  createPatientBody,
  updatePatientBody,
  type HealthEntry,
  type PatientAccessGrant,
  type PatientSummary,
} from '@ghayarly/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../../db/client';
import { patientAccess, patientHealthEntries, patients, userProfiles } from '../../db/schema';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { inContext, requirePrincipal, requireRole } from '../../lib/principal';
import { parse } from '../../lib/validate';

const idParams = z.object({ id: z.string().uuid() });

export async function listMyPatients(tx: Tx, userId: string): Promise<PatientSummary[]> {
  const rows = await tx
    .select({ p: patients, a: patientAccess })
    .from(patients)
    .innerJoin(patientAccess, and(eq(patientAccess.patientId, patients.id), eq(patientAccess.userId, userId), eq(patientAccess.status, 'ACTIVE')))
    .orderBy(sql`case when ${patientAccess.relationship} = 'SELF' then 0 else 1 end`, asc(patients.createdAt));
  return rows.map(({ p, a }) => toSummary(p, a));
}

export async function getMyPatient(tx: Tx, userId: string, patientId: string): Promise<PatientSummary | null> {
  const [row] = await tx
    .select({ p: patients, a: patientAccess })
    .from(patients)
    .innerJoin(patientAccess, and(eq(patientAccess.patientId, patients.id), eq(patientAccess.userId, userId), eq(patientAccess.status, 'ACTIVE')))
    .where(eq(patients.id, patientId));
  return row ? toSummary(row.p, row.a) : null;
}

function toSummary(p: typeof patients.$inferSelect, a: typeof patientAccess.$inferSelect): PatientSummary {
  return {
    id: p.id,
    displayName: p.displayName,
    dateOfBirth: p.dateOfBirth,
    ageYears: ageInYears(p.dateOfBirth),
    sex: p.sex,
    bloodType: p.bloodType,
    bloodTypeProvenance: p.bloodTypeProvenance,
    governorate: p.governorate,
    city: p.city,
    phone: p.phone,
    emergencyContactName: p.emergencyContactName,
    emergencyContactPhone: p.emergencyContactPhone,
    emergencyContactRelation: p.emergencyContactRelation,
    baselineCompletedAt: p.baselineCompletedAt,
    relationship: a.relationship,
    accessLevel: a.accessLevel,
    consentBasis: a.consentBasis,
    isDemo: p.isDemo,
  };
}

export async function patientRoutes(app: FastifyInstance) {
  app.get('/patients', async (request) => {
    const principal = await requirePrincipal(request);
    return inContext(request, principal, (tx) => listMyPatients(tx, principal.userId));
  });

  app.post('/patients', async (request, reply) => {
    const principal = await requireRole(request, 'PATIENT');
    const body = parse(createPatientBody, request.body);
    const summary = await inContext(request, principal, async (tx) => {
      const result = await tx.execute<{ id: string }>(
        sql`select app.create_patient_profile(${body.displayName}, ${body.dateOfBirth}::date, ${body.sex}::app.sex,
            ${body.relationship}::app.relationship, ${body.consentBasis}::app.consent_basis, ${body.consentStatementVersion}) as id`,
      );
      const id = result.rows[0]!.id;
      return (await getMyPatient(tx, principal.userId, id))!;
    });
    return reply.status(201).send(summary);
  });

  app.get('/patients/:id', async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParams, request.params);
    const summary = await inContext(request, principal, (tx) => getMyPatient(tx, principal.userId, id));
    if (!summary) throw notFound('Patient');
    return summary;
  });

  app.patch('/patients/:id', async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParams, request.params);
    const body = parse(updatePatientBody, request.body);
    return inContext(request, principal, async (tx) => {
      const { baselineCompleted, ...fields } = body;
      const updated = await tx
        .update(patients)
        .set({ ...fields, ...(baselineCompleted ? { baselineCompletedAt: new Date().toISOString() } : {}) })
        .where(eq(patients.id, id))
        .returning({ id: patients.id });
      if (!updated.length) throw notFound('Patient');
      await audit(tx, {
        actorUserId: principal.userId,
        action: 'patient.profile.updated',
        entityType: 'patient',
        entityId: id,
        patientId: id,
        requestId: request.id,
        metadata: { fields: Object.keys(body) },
      });
      return (await getMyPatient(tx, principal.userId, id))!;
    });
  });

  app.get('/patients/:id/health-entries', async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParams, request.params);
    return inContext(request, principal, async (tx): Promise<HealthEntry[]> => {
      if (!(await getMyPatient(tx, principal.userId, id))) throw notFound('Patient');
      const [me] = await tx.select({ name: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.userId, principal.userId));
      const rows = await tx
        .select()
        .from(patientHealthEntries)
        .where(and(eq(patientHealthEntries.patientId, id), eq(patientHealthEntries.status, 'ACTIVE')))
        .orderBy(asc(patientHealthEntries.kind), desc(patientHealthEntries.createdAt));
      return rows.map((r) => ({
        id: r.id,
        patientId: r.patientId,
        kind: r.kind,
        title: r.title,
        detail: r.detail,
        note: r.note,
        provenance: r.provenance,
        recordedByName: r.recordedByUserId === principal.userId ? (me?.name ?? null) : null,
        verifiedAt: r.verifiedAt,
        createdAt: r.createdAt,
      }));
    });
  });

  app.post('/patients/:id/health-entries', async (request, reply) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParams, request.params);
    const body = parse(createHealthEntryBody, request.body);
    const entry = await inContext(request, principal, async (tx) => {
      if (!(await getMyPatient(tx, principal.userId, id))) throw notFound('Patient');
      // Provenance is re-derived by the database (patient vs caregiver); clinicians verify later.
      const [row] = await tx
        .insert(patientHealthEntries)
        .values({ patientId: id, kind: body.kind, title: body.title, detail: body.detail ?? null, note: body.note ?? null, provenance: 'PATIENT_REPORTED', recordedByUserId: principal.userId })
        .returning();
      await audit(tx, { actorUserId: principal.userId, action: 'patient.health_entry.created', entityType: 'health_entry', entityId: row!.id, patientId: id, requestId: request.id, metadata: { kind: body.kind } });
      return row!;
    });
    return reply.status(201).send(entry);
  });

  app.delete('/patients/:id/health-entries/:entryId', async (request) => {
    const principal = await requirePrincipal(request);
    const { id, entryId } = parse(idParams.extend({ entryId: z.string().uuid() }), request.params);
    await inContext(request, principal, async (tx) => {
      const updated = await tx
        .update(patientHealthEntries)
        .set({ status: 'ENTERED_IN_ERROR' })
        .where(and(eq(patientHealthEntries.id, entryId), eq(patientHealthEntries.patientId, id)))
        .returning({ id: patientHealthEntries.id });
      if (!updated.length) throw notFound('Health entry');
      await audit(tx, { actorUserId: principal.userId, action: 'patient.health_entry.entered_in_error', entityType: 'health_entry', entityId: entryId, patientId: id, requestId: request.id });
    });
    return { ok: true };
  });

  app.get('/patients/:id/access', async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParams, request.params);
    return inContext(request, principal, async (tx): Promise<PatientAccessGrant[]> => {
      if (!(await getMyPatient(tx, principal.userId, id))) throw notFound('Patient');
      const rows = await tx
        .select({ a: patientAccess, name: userProfiles.displayName })
        .from(patientAccess)
        .leftJoin(userProfiles, eq(userProfiles.userId, patientAccess.userId))
        .where(eq(patientAccess.patientId, id))
        .orderBy(asc(patientAccess.grantedAt));
      return rows.map(({ a, name }) => ({
        userId: a.userId,
        displayName: a.userId === principal.userId ? (name ?? 'You') : (name ?? 'Family member'),
        relationship: a.relationship,
        accessLevel: a.accessLevel,
        consentBasis: a.consentBasis,
        status: a.status,
        grantedAt: a.grantedAt,
      }));
    });
  });

  app.delete('/patients/:id/access/:userId', async (request) => {
    const principal = await requirePrincipal(request);
    const { id, userId } = parse(idParams.extend({ userId: z.string().min(1).max(64) }), request.params);
    await inContext(request, principal, (tx) => tx.execute(sql`select app.revoke_patient_access(${id}::uuid, ${userId})`));
    return { ok: true };
  });
}
