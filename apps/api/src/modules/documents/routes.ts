/**
 * Medical documents, AI reading of lab reports and lab results (migration 0021, ADR 0011).
 *
 * Reading a report: every gateway gate in the database (flag, route, consents, approved model,
 * budget, weekly ANALYSES allowance) → the model TRANSCRIBES the results table into strict JSON →
 * the API validates it and derives numbers, printed ranges and range status deterministically →
 * rows are stored PENDING_REVIEW → the person confirms, corrects or rejects each one.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  deriveLabRow,
  DOCUMENT_KINDS,
  isPrintedCritical,
  manualLabResultBody,
  reviewLabResultBody,
  safeIsoDate,
  uploadDocumentBody,
  type DocumentAiStatus,
  type DocumentContentType,
  type DocumentExtraction,
  type LabResult,
  type MedicalDocument,
  type MedicalDocumentDetail,
} from '@ghayarly/shared';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { withContext, type Tx } from '../../db/client';
import { documentExtractions, labResults, medicalDocuments, userProfiles } from '../../db/schema';
import { AiProviderError, ATTACHMENT_SUPPORT, configuredProviders, type AiProviderCode, type AiResult } from '../../integrations/ai';
import { inspectDocument } from '../../lib/documents';
import { AppError, notFound, unprocessable } from '../../lib/errors';
import { inContext, requirePrincipal, requireRole, type Principal } from '../../lib/principal';
import { sessionKey } from '../../lib/rateLimitKey';
import { parse } from '../../lib/validate';
import { allowance, preferences, providerArray } from '../ai/routes';
import { endUserRefFor } from '../ai/safety';
import { labReadingRequest, parseLabReading } from './reading';

const ROUTE = 'patient.document';
const idParam = z.object({ id: z.string().uuid() });
const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

type Candidate = { provider: AiProviderCode; modelId: string; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' };
type Reservation = { reservation_id: string; candidates: Candidate[]; max_output_tokens: number };

const extractionDto = (x: typeof documentExtractions.$inferSelect): DocumentExtraction => ({
  id: x.id,
  status: x.status as DocumentExtraction['status'],
  labName: x.labName,
  collectedOn: x.collectedOn,
  rowCount: x.rowCount,
  createdAt: iso(x.createdAt)!,
  completedAt: iso(x.completedAt),
  simulated: x.provider === 'SIMULATED',
});

const resultDto = (r: typeof labResults.$inferSelect): LabResult => ({
  id: r.id,
  patientId: r.patientId,
  documentId: r.documentId,
  testName: r.testName,
  valueText: r.valueText,
  valueNumeric: r.valueNumeric,
  unit: r.unit,
  referenceText: r.referenceText,
  referenceLow: r.referenceLow,
  referenceHigh: r.referenceHigh,
  printedFlag: r.printedFlag,
  printedCritical: isPrintedCritical(r.printedFlag),
  rangeStatus: r.rangeStatus as LabResult['rangeStatus'],
  observedOn: r.observedOn,
  source: r.source as LabResult['source'],
  reviewStatus: r.reviewStatus as LabResult['reviewStatus'],
  provenance: r.provenance as LabResult['provenance'],
  corrected: r.corrected,
});

// Columns without the file itself (lists never load bytes).
const docColumns = {
  id: medicalDocuments.id,
  patientId: medicalDocuments.patientId,
  kind: medicalDocuments.kind,
  title: medicalDocuments.title,
  contentType: medicalDocuments.contentType,
  byteSize: medicalDocuments.byteSize,
  documentDate: medicalDocuments.documentDate,
  createdAt: medicalDocuments.createdAt,
};
type DocRow = { [K in keyof typeof docColumns]: (typeof medicalDocuments.$inferSelect)[K] };

async function documentDtos(tx: Tx, docs: DocRow[]): Promise<MedicalDocument[]> {
  if (!docs.length) return [];
  const ids = docs.map((d) => d.id);
  const xs = await tx.select().from(documentExtractions).where(inArray(documentExtractions.documentId, ids)).orderBy(desc(documentExtractions.createdAt));
  const pending = await tx
    .select({ documentId: labResults.documentId, n: sql<number>`count(*)::int` })
    .from(labResults)
    .where(and(inArray(labResults.documentId, ids), eq(labResults.reviewStatus, 'PENDING_REVIEW')))
    .groupBy(labResults.documentId);
  return docs.map((d) => {
    const latest = xs.find((x) => x.documentId === d.id);
    return {
      id: d.id,
      patientId: d.patientId,
      kind: d.kind as MedicalDocument['kind'],
      title: d.title,
      contentType: d.contentType as MedicalDocument['contentType'],
      byteSize: d.byteSize,
      documentDate: d.documentDate,
      createdAt: iso(d.createdAt)!,
      latestExtraction: latest ? extractionDto(latest) : null,
      pendingReview: pending.find((p) => p.documentId === d.id)?.n ?? 0,
    };
  });
}

async function documentDetail(tx: Tx, id: string): Promise<MedicalDocumentDetail> {
  const [d] = await tx.select(docColumns).from(medicalDocuments).where(eq(medicalDocuments.id, id));
  if (!d) throw notFound('Document');
  const [dto] = await documentDtos(tx, [d]);
  const rows = await tx
    .select()
    .from(labResults)
    .where(and(eq(labResults.documentId, id), ne(labResults.reviewStatus, 'REJECTED')))
    .orderBy(labResults.createdAt, labResults.testName);
  return { ...dto!, results: rows.map(resultDto) };
}

export async function documentRoutes(app: FastifyInstance) {
  const { ai, env, db } = app.services;

  async function aiStatus(request: FastifyRequest, principal: Principal): Promise<DocumentAiStatus> {
    return inContext(request, principal, async (tx) => {
      const r = await tx.execute<{ feature_on: boolean; internal_test: boolean; consented: boolean; route_on: boolean; eligible: number; eligible_free: number; budget_ok: boolean }>(
        sql`select * from app.ai_route_status(${ROUTE}, ${providerArray(configuredProviders(ai))})`,
      );
      const s = r.rows[0];
      const docConsent = (await tx.execute<{ ok: boolean }>(sql`select app.has_current_consent('AI_DOCUMENT_PROCESSING') as ok`)).rows[0]?.ok ?? false;
      const unavailableReason: DocumentAiStatus['unavailableReason'] =
        !s || (!s.feature_on && !s.internal_test) ? 'FEATURE_DISABLED'
        : !s.route_on || s.eligible === 0 ? 'NOT_CONFIGURED'
        : s.eligible_free === 0 && !s.budget_ok ? 'PAUSED'
        : !s.consented ? 'CONSENT_REQUIRED'
        : !docConsent ? 'DOCUMENT_CONSENT_REQUIRED'
        : null;
      return { unavailableReason, allowance: unavailableReason === 'FEATURE_DISABLED' ? null : await allowance(tx, ROUTE) };
    });
  }

  app.get('/ai/documents', async (request) => aiStatus(request, await requirePrincipal(request)));

  // ---------------------------------------------------------------- documents
  app.get('/patients/:id/documents', async (request): Promise<MedicalDocument[]> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, async (tx) => {
      // RLS returns only documents of profiles the person may view.
      const docs = await tx.select(docColumns).from(medicalDocuments).where(eq(medicalDocuments.patientId, id)).orderBy(desc(medicalDocuments.createdAt)).limit(200);
      return documentDtos(tx, docs);
    });
  });

  app.post('/documents', { bodyLimit: 15 * 1024 * 1024, config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: sessionKey } } }, async (request, reply) => {
    const principal = await requireRole(request, 'PATIENT');
    const b = parse(uploadDocumentBody, request.body);
    const bytes = Buffer.from(b.dataBase64, 'base64');
    const inspected = inspectDocument(bytes);
    // The type comes from the bytes; a declared type that disagrees is refused.
    if (!inspected || inspected.type !== b.contentType) throw unprocessable('DOCUMENT_TYPE_INVALID', 'Upload a PDF, JPEG, PNG or WebP file');
    if (bytes.length > 10 * 1024 * 1024) throw unprocessable('DOCUMENT_TOO_LARGE', 'Files are limited to 10 MB');
    const detail = await inContext(request, principal, async (tx) => {
      const [d] = await tx
        .insert(medicalDocuments)
        .values({ patientId: b.patientId, uploadedByUserId: principal.userId, kind: b.kind, title: b.title, contentType: inspected.type, bytes, byteSize: bytes.length, sha256: inspected.sha256, documentDate: b.documentDate ?? null })
        .returning({ id: medicalDocuments.id });
      return documentDetail(tx, d!.id);
    });
    return reply.status(201).send(detail);
  });

  app.get('/documents/:id', async (request): Promise<MedicalDocumentDetail> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, (tx) => documentDetail(tx, id));
  });

  app.patch('/documents/:id', async (request): Promise<MedicalDocumentDetail> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    const b = parse(z.object({ title: z.string().trim().min(1).max(120), kind: z.enum(DOCUMENT_KINDS), documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }).partial(), request.body);
    return inContext(request, principal, async (tx) => {
      if (Object.keys(b).length) {
        const u = await tx.update(medicalDocuments).set(b).where(eq(medicalDocuments.id, id)).returning({ id: medicalDocuments.id });
        if (!u.length) throw notFound('Document');
      }
      return documentDetail(tx, id);
    });
  });

  app.delete('/documents/:id', async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, async (tx) => {
      const d = await tx.delete(medicalDocuments).where(eq(medicalDocuments.id, id)).returning({ id: medicalDocuments.id });
      if (!d.length) throw notFound('Document');
      return { ok: true };
    });
  });

  // A browser tab or native viewer cannot send the session: a single-use, 60-second link instead.
  app.post('/documents/:id/view-link', { config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: sessionKey } } }, async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    const ticket = randomBytes(32).toString('base64url');
    const expires = await inContext(request, principal, async (tx) => (await tx.execute<{ e: string }>(sql`select app.document_view_ticket_create(${id}::uuid, ${sha256(ticket)}) as e`)).rows[0]!.e);
    return { url: `${env.API_PUBLIC_URL}/v1/documents/${id}/view?t=${ticket}`, expiresAt: iso(expires) };
  });

  app.get('/documents/:id/view', async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const { t } = parse(z.object({ t: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }), request.query);
    let userId: string;
    try {
      userId = (await withContext(db, { userId: null, demoMode: env.DEMO_MODE, requestId: request.id }, (tx) => tx.execute<{ u: string }>(sql`select app.document_view_ticket_claim(${id}::uuid, ${sha256(t)}) as u`))).rows[0]!.u;
    } catch {
      throw new AppError(403, 'DOCUMENT_LINK_INVALID', 'This link has expired. Open the document again from the app.');
    }
    // Read as that person: access is re-checked by RLS at the moment of reading.
    const [d] = await withContext(db, { userId, demoMode: env.DEMO_MODE, requestId: request.id }, (tx) =>
      tx.select({ bytes: medicalDocuments.bytes, contentType: medicalDocuments.contentType }).from(medicalDocuments).where(eq(medicalDocuments.id, id)),
    );
    if (!d) throw notFound('Document');
    return reply
      .header('content-type', d.contentType)
      .header('content-disposition', `inline; filename="document.${d.contentType === 'application/pdf' ? 'pdf' : d.contentType.split('/')[1]}"`)
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "frame-ancestors 'none'")
      .send(d.bytes);
  });

  // ---------------------------------------------------------------- AI reading
  app.post('/documents/:id/extract', { config: { rateLimit: { max: 6, timeWindow: '1 minute', keyGenerator: sessionKey } } }, async (request): Promise<MedicalDocumentDetail> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    const status = await aiStatus(request, principal);
    if (status.unavailableReason) {
      const consent = status.unavailableReason === 'CONSENT_REQUIRED' || status.unavailableReason === 'DOCUMENT_CONSENT_REQUIRED';
      const code = status.unavailableReason === 'CONSENT_REQUIRED' ? 'AI_CONSENT_REQUIRED' : status.unavailableReason === 'DOCUMENT_CONSENT_REQUIRED' ? 'AI_DOCUMENT_CONSENT_REQUIRED' : status.unavailableReason;
      throw new AppError(consent ? 403 : 409, code, 'Reading documents with AI is not available');
    }

    const prep = await inContext(request, principal, async (tx) => {
      const [doc] = await tx.select().from(medicalDocuments).where(eq(medicalDocuments.id, id));
      if (!doc) throw notFound('Document');
      if (doc.kind !== 'LAB_REPORT') throw unprocessable('DOCUMENT_NOT_A_LAB_REPORT', 'Only lab reports can be read');
      // Only providers whose adapter can pass this file type are offered to the router.
      const able = configuredProviders(ai).filter((c) => ATTACHMENT_SUPPORT[c].includes(doc.contentType as never));
      if (!able.length) throw new AppError(409, 'NOT_CONFIGURED', 'No configured model can read this file type');
      const prefs = await preferences(tx, principal.userId);
      const [profile] = await tx.select({ locale: userProfiles.locale }).from(userProfiles).where(eq(userProfiles.userId, principal.userId));
      const locale = prefs.replyLanguage === 'auto' ? (profile?.locale === 'en' ? 'en' : 'ar') : prefs.replyLanguage;
      const reservation = (await tx.execute<Reservation>(sql`select * from app.ai_reserve(${ROUTE}, 1, ${providerArray(able)}, null, ${locale})`)).rows[0]!;
      const extraction = (await tx.execute<{ id: string }>(sql`select app.document_extraction_start(${id}::uuid, ${reservation.reservation_id}::uuid) as id`)).rows[0]!.id;
      return { doc, reservation, extraction };
    });

    // Provider call outside any transaction; one fallback on a retryable failure (another provider preferred).
    const { doc, reservation, extraction } = prep;
    const base = {
      ...labReadingRequest({ contentType: doc.contentType as DocumentContentType, bytes: doc.bytes }),
      maxOutputTokens: reservation.max_output_tokens,
      requestId: request.id,
      endUserRef: endUserRefFor(env.BETTER_AUTH_SECRET, principal.userId),
    };
    const [primary, ...rest] = reservation.candidates;
    let result: AiResult | null = null;
    let servedBy: AiProviderCode = primary!.provider;
    try {
      result = await ai[primary!.provider].complete({ ...base, model: primary!.modelId, effort: primary!.effort });
    } catch (e) {
      const fallback = e instanceof AiProviderError && e.retryable ? (rest.find((c) => c.provider !== primary!.provider) ?? rest[0]) : undefined;
      request.log.warn({ provider: primary!.provider, kind: e instanceof AiProviderError ? e.kind : 'UNKNOWN', fallback: fallback?.provider ?? null }, 'document reading failed');
      if (fallback) {
        try {
          servedBy = fallback.provider;
          result = await ai[fallback.provider].complete({ ...base, model: fallback.modelId, effort: fallback.effort });
        } catch (e2) {
          request.log.warn({ provider: servedBy, kind: e2 instanceof AiProviderError ? e2.kind : 'UNKNOWN' }, 'document reading fallback failed');
        }
      }
    }

    const asMe = <T>(fn: (tx: Tx) => Promise<T>) => inContext(request, principal, fn);
    if (!result) {
      await asMe((tx) => tx.execute(sql`select app.document_extraction_fail(${extraction}::uuid, ${'PROVIDER_UNAVAILABLE'}, null, null, null, null, null)`));
      throw new AppError(503, 'AI_UNAVAILABLE', 'The report could not be read right now. Nothing was counted against your allowance.');
    }
    const r = result;
    const u = r.usage;
    if (r.outcome === 'REFUSED') {
      await asMe((tx) => tx.execute(sql`select app.document_extraction_settle(${extraction}::uuid, ${servedBy}::app.ai_provider, ${r.servedModel}, ${u.inputTokens}, ${u.outputTokens}, ${u.cacheReadTokens}, 'REFUSED', 'REFUSED', null, null, '[]'::jsonb)`));
      return asMe((tx) => documentDetail(tx, id));
    }
    // The model's output is untrusted: strict validation, then deterministic derivation of every number.
    const x = parseLabReading(r.text);
    if (!x) {
      await asMe((tx) => tx.execute(sql`select app.document_extraction_fail(${extraction}::uuid, ${'INVALID_OUTPUT'}, ${servedBy}::app.ai_provider, ${r.servedModel}, ${u.inputTokens}, ${u.outputTokens}, ${u.cacheReadTokens})`));
      throw new AppError(502, 'DOCUMENT_READ_FAILED', 'The report could not be read. Nothing was counted against your allowance; you can add results by hand.');
    }
    const notLab = x.documentType === 'OTHER';
    const rows = notLab ? [] : x.results.filter((row) => row.testName && row.value).map((row) => deriveLabRow(row));
    await asMe((tx) =>
      tx.execute(
        sql`select app.document_extraction_settle(${extraction}::uuid, ${servedBy}::app.ai_provider, ${r.servedModel}, ${u.inputTokens}, ${u.outputTokens}, ${u.cacheReadTokens}, ${r.outcome}, ${notLab ? 'NOT_A_LAB_REPORT' : 'COMPLETED'}, ${x.labName}, ${safeIsoDate(x.collectedOn)}::date, ${JSON.stringify(rows)}::jsonb)`,
      ),
    );
    return asMe((tx) => documentDetail(tx, id));
  });

  // ---------------------------------------------------------------- lab results
  app.post('/lab-results/:id/review', async (request): Promise<LabResult> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    const b = parse(reviewLabResultBody, request.body);
    return inContext(request, principal, async (tx) => {
      const [row] = await tx.select().from(labResults).where(eq(labResults.id, id));
      if (!row) throw notFound('Result');
      const d = deriveLabRow({
        testName: b.testName ?? row.testName,
        value: b.valueText ?? row.valueText,
        unit: b.unit !== undefined ? b.unit : row.unit,
        referenceRange: b.referenceText !== undefined ? b.referenceText : row.referenceText,
        flag: row.printedFlag,
      });
      await tx.execute(
        sql`select app.lab_result_review(${id}::uuid, ${b.decision}, ${d.testName}, ${d.valueText}, ${d.valueNumeric}, ${d.unit}, ${d.referenceText}, ${d.referenceLow}, ${d.referenceHigh}, ${d.rangeStatus}, ${b.observedOn ?? null}::date)`,
      );
      const [updated] = await tx.select().from(labResults).where(eq(labResults.id, id));
      return resultDto(updated!);
    });
  });

  app.post('/lab-results', async (request, reply) => {
    const principal = await requirePrincipal(request);
    const b = parse(manualLabResultBody, request.body);
    const d = deriveLabRow({ testName: b.testName, value: b.valueText, unit: b.unit ?? null, referenceRange: b.referenceText ?? null, flag: null });
    const row = await inContext(request, principal, async (tx) => {
      const [r] = await tx
        .insert(labResults)
        .values({ ...d, patientId: b.patientId, documentId: b.documentId ?? null, observedOn: b.observedOn, source: 'MANUAL', reviewStatus: 'CONFIRMED' })
        .returning();
      return r!;
    });
    return reply.status(201).send(resultDto(row));
  });

  app.get('/patients/:id/lab-results', async (request): Promise<LabResult[]> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, async (tx) => {
      const rows = await tx
        .select()
        .from(labResults)
        .where(and(eq(labResults.patientId, id), eq(labResults.reviewStatus, 'CONFIRMED')))
        .orderBy(desc(labResults.observedOn), labResults.testName)
        .limit(1000);
      return rows.map(resultDto);
    });
  });
}
