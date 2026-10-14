import type { ClinicianDashboard, PatientDashboard, PatientSummary } from '@ghayarly/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../../db/client';
import { patientHealthEntries, providerProfiles, providerServices, providerWorkingHours, userProfiles } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { inContext, requireRole } from '../../lib/principal';
import { parse } from '../../lib/validate';
import { listMyPatients } from '../patients/routes';
import { earningsSummary, searchProviders } from '../providers/routes';
import { listProducts } from '../store/routes';

async function entryCounts(tx: Tx, patientId: string) {
  const rows = await tx
    .select({ kind: patientHealthEntries.kind, n: sql<number>`count(*)::int` })
    .from(patientHealthEntries)
    .where(and(eq(patientHealthEntries.patientId, patientId), eq(patientHealthEntries.status, 'ACTIVE')))
    .groupBy(patientHealthEntries.kind);
  const get = (k: string) => rows.find((r) => r.kind === k)?.n ?? 0;
  return { allergies: get('ALLERGY'), conditions: get('CONDITION'), medications: get('MEDICATION'), surgeries: get('SURGERY') };
}

function completeness(p: PatientSummary, counts: Awaited<ReturnType<typeof entryCounts>>): number {
  const checks = [
    true, // name, date of birth and sex are mandatory at creation
    p.bloodType !== 'UNKNOWN',
    Boolean(p.governorate),
    Boolean(p.emergencyContactName && p.emergencyContactPhone),
    Boolean(p.baselineCompletedAt) || counts.allergies + counts.conditions + counts.medications + counts.surgeries > 0,
    p.relationship !== 'SELF' || Boolean(p.phone),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard/patient', async (request): Promise<PatientDashboard> => {
    const principal = await requireRole(request, 'PATIENT');
    const { patientId } = parse(z.object({ patientId: z.string().uuid().optional() }), request.query);
    return inContext(request, principal, async (tx) => {
      const mine = await listMyPatients(tx, principal.userId);
      if (!mine.length) throw new AppError(404, 'NO_PATIENT_PROFILE', 'Create a patient profile first');
      const active = (patientId && mine.find((p) => p.id === patientId)) || mine.find((p) => p.relationship === 'SELF') || mine[0]!;
      const counts = await entryCounts(tx, active.id);
      const family = await Promise.all(
        mine
          .filter((p) => p.id !== active.id)
          .map(async (p) => {
            const c = await entryCounts(tx, p.id);
            const highlights: PatientDashboard['family'][number]['highlights'] = [];
            if (completeness(p, c) < 60) highlights.push({ key: 'home.highlightProfileIncomplete' });
            if (c.allergies > 0) highlights.push({ key: 'home.highlightAllergies', params: { count: c.allergies } });
            if (!highlights.length) highlights.push({ key: 'home.highlightReady' });
            return { patient: p, highlights };
          }),
      );
      const [profile] = await tx.select({ assistantName: userProfiles.assistantName }).from(userProfiles).where(eq(userProfiles.userId, principal.userId));
      const featured = (await listProducts(tx)).slice(0, 2);
      const suggested = await searchProviders(tx, { type: 'DOCTOR', ...(active.governorate ? { governorate: active.governorate } : {}) }, 3);
      return {
        activePatient: active,
        family,
        healthSnapshot: { ...counts, profileCompleteness: completeness(active, counts) },
        todayTasks: { status: 'NOT_YET_AVAILABLE' },
        appointments: { status: 'NOT_YET_AVAILABLE' },
        nurseVisits: { status: 'NOT_YET_AVAILABLE' },
        medicationReminders: { status: 'NOT_YET_AVAILABLE', activeMedications: counts.medications },
        careTeam: { status: 'NOT_YET_AVAILABLE' },
        aiAssistant: { status: 'NOT_CONFIGURED', assistantName: profile?.assistantName ?? null },
        tetrasol: { status: featured.length ? 'READY' : 'EMPTY', featured },
        suggestedProviders: suggested,
      };
    });
  });

  app.get('/dashboard/clinician', async (request): Promise<ClinicianDashboard> => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    return inContext(request, principal, async (tx) => {
      const [p] = await tx.select().from(providerProfiles).where(eq(providerProfiles.userId, principal.userId));
      if (!p) throw new AppError(404, 'NO_PROVIDER_PROFILE', 'Create your professional profile first');
      const earnings = await earningsSummary(tx, principal.userId);
      const [{ services } = { services: 0 }] = await tx
        .select({ services: sql<number>`count(*)::int` })
        .from(providerServices)
        .where(eq(providerServices.providerUserId, principal.userId));
      const [{ days } = { days: 0 }] = await tx
        .select({ days: sql<number>`count(distinct ${providerWorkingHours.weekday})::int` })
        .from(providerWorkingHours)
        .where(eq(providerWorkingHours.providerUserId, principal.userId));
      return {
        providerType: p.providerType,
        displayName: p.displayNameEn,
        verificationStatus: p.verificationStatus,
        availabilityStatus: p.availabilityStatus,
        bookable: p.verificationStatus === 'APPROVED',
        mfaEnrolled: principal.user.twoFactorEnabled,
        todayAppointments: { status: 'NOT_YET_AVAILABLE' },
        activePatients: { status: 'NOT_YET_AVAILABLE' },
        messages: { status: 'NOT_YET_AVAILABLE' },
        careTasks: { status: 'NOT_YET_AVAILABLE' },
        earnings: {
          todayNetPiasters: earnings.todayNetPiasters,
          weekNetPiasters: earnings.weekNetPiasters,
          availableForPayoutPiasters: earnings.availableForPayoutPiasters,
          containsDemoData: earnings.containsDemoData,
        },
        aiAssistant: { status: 'NOT_CONFIGURED' },
        loyalty: { status: 'NOT_YET_AVAILABLE' },
        serviceCount: services,
        workingDays: days,
      };
    });
  });
}
