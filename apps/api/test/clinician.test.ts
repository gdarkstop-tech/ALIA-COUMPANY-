/**
 * Record shares and the clinician documentation copilot (migrations 0023–0024, ADR 0013). The
 * ANTHROPIC slot is scripted: these tests prove access control (only a live share to an approved
 * clinician, read-only, limited, revocable, expiring), the separate AI permission and clinician
 * terms, role scope, that drafts stay drafts until signed, that the guard rejects new doses,
 * diagnoses and orders, metering, and the evaluation run — not any model's drafting quality.
 */
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import type { AiProvider, AiRequest, AiResult } from '../src/integrations/ai';
import { buildServer } from '../src/server';
import { grantRole, ownerPool, PASSWORD, signUp, type Client } from './helpers';

type Script = (req: AiRequest) => AiResult | Promise<AiResult>;
const calls: AiRequest[] = [];
const USAGE = { inputTokens: 2000, outputTokens: 600, cacheReadTokens: 0 };
const answer = (content: object | string): AiResult => ({ outcome: 'ANSWERED', text: typeof content === 'string' ? content : JSON.stringify(content), servedModel: 'claude-sonnet-5-5', usage: USAGE });
const NOTES = 'Home visit. Wound on left shin, 3 cm, less redness, no discharge. Continue amoxicillin 500 mg three times daily. Review in 5 days.';
const VISIT = { subjective: 'Not documented.', objective: 'Wound on left shin, 3 cm, less redness, no discharge.', assessment: 'Less redness than before.', plan: 'Continue amoxicillin 500 mg three times daily. Review in 5 days.', checksForClinician: ['A penicillin allergy is recorded.'] };
let script: Script = () => answer(VISIT);
const scripted: AiProvider = {
  code: 'ANTHROPIC',
  status: 'CONFIGURED',
  complete: async (req) => {
    calls.push(req);
    return script(req);
  },
  healthCheck: async () => ({ ok: true, detail: 'scripted', checkedAt: new Date().toISOString() }),
};

let app: FastifyInstance;
let owner: pg.Pool;
const SELF = { displayName: 'Share Tester', dateOfBirth: '1958-06-06', sex: 'FEMALE', relationship: 'SELF', consentBasis: 'SELF', consentAttested: true, consentStatementVersion: 'v1' };

async function grantConsent(c: Client, types: string[], granted = true) {
  const state = await c.req({ method: 'GET', url: '/v1/me/consents' });
  const consents = state.json.consents.filter((x: { type: string }) => types.includes(x.type)).map((x: { type: string; currentVersion: string }) => ({ type: x.type, version: x.currentVersion, granted }));
  expect((await c.req({ method: 'POST', url: '/v1/me/consents', body: { consents, source: 'web', locale: 'en' } })).status).toBe(200);
}
/** A clinician with an APPROVED profile (the verification workflow itself is tested in providers.test.ts). */
async function clinician(role: 'DOCTOR' | 'NURSE', opts: { approved?: boolean; internal?: boolean; terms?: boolean } = {}) {
  const c = await signUp(app, { role, name: role });
  const body = { providerType: role, displayNameAr: role === 'DOCTOR' ? 'د. مشاركة' : 'ممرضة مشاركة', displayNameEn: role === 'DOCTOR' ? 'Dr. Share' : 'Nurse Share', gender: 'FEMALE', yearsExperience: 8, governorate: 'CAIRO', city: 'Nasr City', ...(role === 'DOCTOR' ? { specialty: 'GENERAL_SURGERY' } : {}) };
  expect((await c.req({ method: 'PUT', url: '/v1/provider/me', body })).status).toBe(200);
  if (opts.approved !== false) await owner.query("update app.provider_profiles set verification_status = 'APPROVED', verified_at = now() where user_id = $1", [c.userId]);
  await c.req({ method: 'GET', url: '/v1/me' });
  if (opts.internal) await owner.query("update app.user_profiles set account_kind = 'INTERNAL_TEST', locale = 'en' where user_id = $1", [c.userId]);
  if (opts.terms) await grantConsent(c, ['AI_CLINICAL_DOCUMENTATION']);
  return c;
}
/** `internal`: an internal-test account, whose records are test data (they may only go to test clinicians). */
async function patient(opts: { internal?: boolean } = {}) {
  const c = await signUp(app, { role: 'PATIENT' });
  if (opts.internal) await owner.query("update app.user_profiles set account_kind = 'INTERNAL_TEST' where user_id = $1", [c.userId]);
  const p = await c.req({ method: 'POST', url: '/v1/patients', body: SELF });
  expect(p.status, JSON.stringify(p.json)).toBe(201);
  await c.req({ method: 'PATCH', url: `/v1/patients/${p.json.id}`, body: { phone: '+201000000999', governorate: 'CAIRO', city: 'Heliopolis' } });
  await c.req({ method: 'POST', url: `/v1/patients/${p.json.id}/health-entries`, body: { kind: 'ALLERGY', title: 'Penicillin' } });
  await c.req({ method: 'POST', url: `/v1/patients/${p.json.id}/health-entries`, body: { kind: 'MEDICATION', title: 'Amoxicillin 500 mg' } });
  await c.req({ method: 'POST', url: `/v1/patients/${p.json.id}/observations`, body: { kind: 'BLOOD_PRESSURE', value: 142, value2: 91, measuredAt: new Date(Date.now() - 86_400_000).toISOString(), note: 'private note' } });
  return { c, patientId: p.json.id as string };
}
const share = (c: Client, patientId: string, providerUserId: string, days = 30, aiAllowed = false) => c.req({ method: 'POST', url: '/v1/care-shares', body: { patientId, providerUserId, days, aiAllowed } });
const draft = (c: Client, patientId: string, docType: string, notes = NOTES) => c.req({ method: 'POST', url: `/v1/clinician/patients/${patientId}/drafts`, body: { docType, notes } });
const usageRows = async (userId: string) => (await owner.query("select status, outcome, metric, cost_micros::int as cost from app.ai_usage where user_id = $1 and route_key = 'clinician.documentation' order by reserved_at", [userId])).rows;

beforeAll(async () => {
  app = await buildServer(loadEnv(process.env), { ai: { ANTHROPIC: scripted } });
  await app.ready();
  owner = ownerPool();
  await owner.query("update app.ai_models set price_verified_at = now(), active = true where model_id = 'claude-sonnet-5-5'");
  await owner.query("update app.ai_routes set enabled = true where key = 'clinician.documentation'");
  await owner.query('update app.ai_budget set monthly_limit_micros = 50000000');
});
beforeEach(() => {
  calls.length = 0;
  script = () => answer(VISIT);
});
afterAll(async () => {
  await owner.query("update app.ai_routes set enabled = false where key = 'clinician.documentation'");
  await owner.query("update app.ai_models set price_verified_at = null, active = false where model_id = 'claude-sonnet-5-5'");
  await owner.query('update app.ai_budget set monthly_limit_micros = null');
  await owner.end();
  await app.close();
});

describe('record shares', () => {
  it('go only to an approved, real clinician, for 7 / 30 / 90 days, from someone who manages the profile', async () => {
    const { c, patientId } = await patient();
    const doctor = await clinician('DOCTOR');
    const r = await share(c, patientId, doctor.userId, 7);
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json).toMatchObject({ status: 'ACTIVE', aiAllowed: false, providerName: 'د. مشاركة', providerType: 'DOCTOR' });
    expect(Date.parse(r.json.expiresAt) - Date.now()).toBeLessThanOrEqual(7 * 86_400_000);

    const pending = await clinician('NURSE', { approved: false });
    expect((await share(c, patientId, pending.userId)).json.error.code).toBe('CLINICIAN_NOT_AVAILABLE');
    const demo = await clinician('NURSE');
    await owner.query('update app.provider_profiles set is_demo = true where user_id = $1', [demo.userId]);
    expect((await share(c, patientId, demo.userId)).json.error.code).toBe('CLINICIAN_NOT_AVAILABLE');
    expect((await share(c, patientId, doctor.userId, 14)).status).toBe(400);
    const stranger = await signUp(app, { role: 'PATIENT' });
    expect((await share(stranger, patientId, doctor.userId)).status).toBe(404);
    // Sharing again replaces the earlier share (one live share per clinician).
    expect((await share(c, patientId, doctor.userId, 30, true)).status).toBe(201);
    const list = (await c.req({ method: 'GET', url: `/v1/patients/${patientId}/care-shares` })).json;
    expect(list.map((s: { status: string; aiAllowed: boolean }) => [s.status, s.aiAllowed])).toEqual([['ACTIVE', true], ['REVOKED', false]]);
    const audit = await owner.query("select count(*)::int as n from app.audit_log where action = 'patient.care_share.granted' and patient_id = $1", [patientId]);
    expect(audit.rows[0].n).toBe(2);
  });

  it('let the clinician read a limited, read-only record; nothing else, and only while the share lasts', async () => {
    const { c, patientId } = await patient();
    await c.req({ method: 'POST', url: '/v1/lab-results', body: { patientId, testName: 'HbA1c', valueText: '7.4', unit: '%', referenceText: '< 5.7', observedOn: new Date().toISOString().slice(0, 10) } });
    await owner.query("insert into app.lab_results (patient_id, test_name, value_text, value_numeric, unit, source, review_status, extracted, observed_on) values ($1, 'Unconfirmed', '1', 1, 'x', 'AI_EXTRACTED', 'PENDING_REVIEW', '{}', current_date)", [patientId]);
    const doctor = await clinician('DOCTOR');
    expect((await doctor.req({ method: 'GET', url: `/v1/clinician/patients/${patientId}` })).status).toBe(404);
    const s = await share(c, patientId, doctor.userId);

    const list = (await doctor.req({ method: 'GET', url: '/v1/clinician/patients' })).json;
    expect(list).toEqual([expect.objectContaining({ patientId, displayName: 'Share Tester', sex: 'FEMALE', governorate: 'CAIRO', aiAllowed: false })]);
    const view = await doctor.req({ method: 'GET', url: `/v1/clinician/patients/${patientId}` });
    expect(view.status, JSON.stringify(view.json)).toBe(200);
    expect(JSON.stringify(view.json)).not.toContain('+201000000999');
    expect(JSON.stringify(view.json)).not.toContain('Heliopolis');
    expect(JSON.stringify(view.json)).not.toContain('private note');
    expect(view.json.entries.map((e: { title: string }) => e.title).sort()).toEqual(['Amoxicillin 500 mg', 'Penicillin']);
    expect(view.json.analytics.series.map((x: { key: string }) => x.key)).toEqual(['VITAL:BLOOD_PRESSURE', 'LAB:hba1c|%']);
    // Read-only and limited: no profile record, no adding readings, no documents of the person.
    expect((await doctor.req({ method: 'GET', url: `/v1/patients/${patientId}` })).status).toBe(404);
    expect((await doctor.req({ method: 'POST', url: `/v1/patients/${patientId}/observations`, body: { kind: 'WEIGHT', value: 70, measuredAt: new Date().toISOString() } })).status).toBe(403);
    expect((await doctor.req({ method: 'GET', url: `/v1/patients/${patientId}/documents` })).json).toEqual([]);
    const audit = await owner.query("select count(*)::int as n from app.audit_log where action = 'clinician.record.viewed' and actor_user_id = $1", [doctor.userId]);
    expect(audit.rows[0].n).toBe(1);

    // Revoked → gone. A new share that expires → gone. A suspended clinician → gone.
    expect((await c.req({ method: 'POST', url: `/v1/care-shares/${s.json.id}/revoke` })).json).toEqual({ ok: true });
    expect((await doctor.req({ method: 'GET', url: `/v1/clinician/patients/${patientId}` })).status).toBe(404);
    expect((await doctor.req({ method: 'GET', url: '/v1/clinician/patients' })).json).toEqual([]);
    const again = await share(c, patientId, doctor.userId);
    await owner.query("update app.care_shares set created_at = now() - interval '2 days', expires_at = now() - interval '1 second' where id = $1", [again.json.id]);
    expect((await doctor.req({ method: 'GET', url: `/v1/clinician/patients/${patientId}` })).status).toBe(404);
    await share(c, patientId, doctor.userId);
    await owner.query("update app.provider_profiles set verification_status = 'SUSPENDED' where user_id = $1", [doctor.userId]);
    expect((await doctor.req({ method: 'GET', url: `/v1/clinician/patients/${patientId}` })).status).toBe(404);
    // The clinician may end a share too.
    const nurse = await clinician('NURSE');
    const ns = await share(c, patientId, nurse.userId);
    expect((await nurse.req({ method: 'POST', url: `/v1/care-shares/${ns.json.id}/revoke` })).json).toEqual({ ok: true });
    // A clinician account later turned into an internal-test account loses a real record at once.
    await share(c, patientId, nurse.userId);
    expect((await nurse.req({ method: 'GET', url: `/v1/clinician/patients/${patientId}` })).status).toBe(200);
    await owner.query("update app.user_profiles set account_kind = 'INTERNAL_TEST' where user_id = $1", [nurse.userId]);
    expect((await nurse.req({ method: 'GET', url: `/v1/clinician/patients/${patientId}` })).status).toBe(404);
  });
});

describe('documentation copilot', () => {
  it('needs the flag (or an internal account), the clinician terms, the share’s AI permission and a note type in scope', async () => {
    const { c, patientId } = await patient();
    const plain = await clinician('DOCTOR');
    await share(c, patientId, plain.userId, 30, true);
    expect((await plain.req({ method: 'GET', url: '/v1/ai/clinician-copilot' })).json.unavailableReason).toBe('FEATURE_DISABLED');
    await expect(owner.query("update app.feature_flags set enabled = true where key = 'ai.clinician_copilot'")).rejects.toThrow(/regulated_feature_needs_evidence/);
    const pendingDoctor = await clinician('DOCTOR', { approved: false, internal: true, terms: true });
    expect((await pendingDoctor.req({ method: 'GET', url: '/v1/ai/clinician-copilot' })).json.unavailableReason).toBe('NOT_VERIFIED');
    expect((await c.req({ method: 'GET', url: '/v1/ai/clinician-copilot' })).status).toBe(403);

    // An internal-test clinician may use the copilot while the flag is off, so a real record can
    // never be shared with one; only test data (an internal-test account's own records) can.
    const doctor = await clinician('DOCTOR', { internal: true });
    expect((await share(c, patientId, doctor.userId, 30, true)).json.error.code).toBe('CLINICIAN_NOT_AVAILABLE');
    const t = await patient({ internal: true });
    expect((await share(t.c, t.patientId, plain.userId, 30, true)).json.error.code).toBe('CLINICIAN_NOT_AVAILABLE');
    expect((await share(t.c, t.patientId, doctor.userId, 30, true)).status).toBe(201);
    expect((await doctor.req({ method: 'GET', url: '/v1/ai/clinician-copilot' })).json.unavailableReason).toBe('CLINICIAN_TERMS_REQUIRED');
    expect((await draft(doctor, t.patientId, 'VISIT_NOTE')).json.error.code).toBe('AI_CLINICAL_TERMS_REQUIRED');
    await grantConsent(doctor, ['AI_CLINICAL_DOCUMENTATION']);
    expect((await doctor.req({ method: 'GET', url: '/v1/ai/clinician-copilot' })).json).toMatchObject({ unavailableReason: null, allowance: { metric: 'CLINICAL_DRAFTS', weeklyLimit: 40 } });

    const noAi = await patient({ internal: true });
    await share(noAi.c, noAi.patientId, doctor.userId, 30, false);
    const r = await draft(doctor, noAi.patientId, 'VISIT_NOTE');
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('CARE_SHARE_AI_NOT_ALLOWED');
    const nurse = await clinician('NURSE', { internal: true, terms: true });
    await share(t.c, t.patientId, nurse.userId, 30, true);
    expect((await draft(nurse, t.patientId, 'VISIT_NOTE')).json.error.code).toBe('DOCUMENT_TYPE_NOT_IN_SCOPE');
    expect(calls).toHaveLength(0);
    expect(await usageRows(doctor.userId)).toEqual([]);
  });

  it('drafts from the clinician’s notes with a minimal context; the draft is the clinician’s until signed, then the person sees it', async () => {
    const { c, patientId } = await patient({ internal: true });
    const doctor = await clinician('DOCTOR', { internal: true, terms: true });
    const s = await share(c, patientId, doctor.userId, 30, true);
    const r = await draft(doctor, patientId, 'VISIT_NOTE');
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json).toMatchObject({ status: 'DRAFT', docType: 'VISIT_NOTE', authorRole: 'DOCTOR', content: VISIT, edited: false, simulated: false });

    const req = calls[0]!;
    expect(req.jsonSchema?.name).toBe('clinical_draft');
    expect(req.system).toContain('Never change a dose');
    const sent = req.messages[0]!.content;
    expect(sent).toContain(NOTES);
    expect(sent).toContain('Penicillin');
    expect(sent).toContain('Age band: 60–69; sex: female');
    expect(sent).toContain('Blood pressure (mmHg): latest 142/91');
    for (const secret of ['Share Tester', '+201000000999', 'Heliopolis', 'private note']) expect(sent).not.toContain(secret);
    expect(await usageRows(doctor.userId)).toEqual([{ status: 'SETTLED', outcome: 'ANSWERED', metric: 'CLINICAL_DRAFTS', cost: 10000 }]);

    // Not visible to the person while it is a draft.
    expect((await c.req({ method: 'GET', url: `/v1/patients/${patientId}/clinical-notes` })).json).toEqual([]);
    const id = r.json.id;
    const edited = { ...VISIT, assessment: 'Healing; less redness than last week.' };
    expect((await doctor.req({ method: 'POST', url: `/v1/clinician/drafts/${id}`, body: { action: 'SAVE', content: edited } })).json).toMatchObject({ status: 'DRAFT', edited: true });
    expect((await doctor.req({ method: 'POST', url: `/v1/clinician/drafts/${id}`, body: { action: 'SAVE', content: { plan: 'x' } } })).status).toBe(400);
    const signed = await doctor.req({ method: 'POST', url: `/v1/clinician/drafts/${id}`, body: { action: 'SIGN', content: edited } });
    expect(signed.json).toMatchObject({ status: 'SIGNED', edited: true });
    expect(signed.json.signedAt).not.toBeNull();
    expect((await doctor.req({ method: 'POST', url: `/v1/clinician/drafts/${id}`, body: { action: 'SAVE', content: VISIT } })).json.error.code).toBe('CLINICAL_DRAFT_NOT_EDITABLE');
    const notes = (await c.req({ method: 'GET', url: `/v1/patients/${patientId}/clinical-notes` })).json;
    expect(notes).toEqual([expect.objectContaining({ id, status: 'SIGNED', authorName: 'د. مشاركة', clinicianInput: null, content: edited })]);
    const audit = await owner.query("select count(*)::int as n from app.audit_log where action = 'clinical.note.signed' and actor_user_id = $1", [doctor.userId]);
    expect(audit.rows[0].n).toBe(1);

    // After the share ends, open drafts can no longer be signed.
    const second = await draft(doctor, patientId, 'PATIENT_INSTRUCTIONS', 'Keep the wound dry. Change the dressing every 2 days. Call if fever above 38.');
    script = () => answer({ instructions: ['Keep the wound dry.'], whenToSeekHelp: ['Fever above 38.'], checksForClinician: [] });
    const third = await draft(doctor, patientId, 'PATIENT_INSTRUCTIONS', 'Keep the wound dry. Call if fever above 38.');
    expect(third.json.status).toBe('DRAFT');
    await c.req({ method: 'POST', url: `/v1/care-shares/${s.json.id}/revoke` });
    const late = await doctor.req({ method: 'POST', url: `/v1/clinician/drafts/${third.json.id}`, body: { action: 'SIGN' } });
    expect(late.status).toBe(403);
    expect(late.json.error.code).toBe('CARE_SHARE_ENDED');
    expect(second.status).toBe(502); // VISIT content for an instructions note: wrong shape, rejected
    // A signed note keeps the name it was signed with, even when the clinician leaves the directory.
    await owner.query("update app.provider_profiles set verification_status = 'SUSPENDED' where user_id = $1", [doctor.userId]);
    expect((await c.req({ method: 'GET', url: `/v1/patients/${patientId}/clinical-notes` })).json[0]).toMatchObject({ id, authorName: 'د. مشاركة' });
  });

  it('rejects drafts that add a dose, a diagnosis or an order — paid, not counted, capped at 5 a day', async () => {
    const { c, patientId } = await patient({ internal: true });
    const doctor = await clinician('DOCTOR', { internal: true, terms: true });
    const nurse = await clinician('NURSE', { internal: true, terms: true });
    await share(c, patientId, doctor.userId, 30, true);
    await share(c, patientId, nurse.userId, 30, true);
    const cases: [Client, string, object, string][] = [
      [doctor, 'VISIT_NOTE', { ...VISIT, plan: 'Continue amoxicillin 875 mg twice daily.' }, 'UNGROUNDED_DOSE'],
      [doctor, 'VISIT_NOTE', { ...VISIT, assessment: 'Diagnosis: cellulitis.' }, 'CLINICIAN_ONLY_TERM'],
      [nurse, 'NURSING_NOTE', { assessment: 'BP 168/98.', interventions: 'Checked twice.', evaluation: 'Not documented.', escalation: 'Increase amlodipine.', checksForClinician: [] }, 'CLINICIAN_ONLY_TERM'],
      [nurse, 'WOUND_CARE_NOTE', { woundObservations: 'Clean.', careProvided: 'Foam dressing.', patientResponse: 'Pain 2/10.', nextDressing: 'In 2 days.', escalation: 'Order a wound swab.', checksForClinician: [] }, 'CLINICIAN_ONLY_TERM'],
    ];
    for (const [who, docType, content, reason] of cases) {
      script = () => answer(content);
      const notes = docType === 'VISIT_NOTE' ? NOTES : 'BP 168/98 twice. Wound clean, foam dressing, pain 2/10, next change in 2 days.';
      const r = await draft(who, patientId, docType, notes);
      expect(r.status, reason).toBe(502);
      expect(r.json.error.code).toBe('CLINICAL_DRAFT_REJECTED');
      const failure = (await owner.query('select failure from app.clinical_drafts where author_user_id = $1 order by created_at desc limit 1', [who.userId])).rows[0].failure;
      expect(failure).toBe(`INVALID_OUTPUT:${reason}`);
    }
    const u = await usageRows(nurse.userId);
    expect(u.every((x) => x.status === 'RELEASED' && x.outcome === 'INVALID_OUTPUT' && x.cost === 10000)).toBe(true);
    expect((await nurse.req({ method: 'GET', url: '/v1/ai/clinician-copilot' })).json.allowance.used).toBe(0);
    // Rejected drafts never reach the person or show as notes.
    expect((await c.req({ method: 'GET', url: `/v1/patients/${patientId}/clinical-notes` })).json).toEqual([]);
    script = () => answer('not json');
    for (let i = 0; i < 3; i++) expect((await draft(doctor, patientId, 'VISIT_NOTE')).status).toBe(502);
    expect((await draft(doctor, patientId, 'VISIT_NOTE')).json.error.code).toBe('CLINICAL_DRAFT_LIMIT');
  });
});

describe('account deletion', () => {
  it('ends the clinician’s shares and deletes their unsigned drafts; signed notes stay with the person', async () => {
    const { c, patientId } = await patient({ internal: true });
    const doctor = await clinician('DOCTOR', { internal: true, terms: true });
    await share(c, patientId, doctor.userId, 30, true);
    const signedId = (await draft(doctor, patientId, 'VISIT_NOTE')).json.id as string;
    expect((await doctor.req({ method: 'POST', url: `/v1/clinician/drafts/${signedId}`, body: { action: 'SIGN' } })).json.status).toBe('SIGNED');
    const openId = (await draft(doctor, patientId, 'VISIT_NOTE')).json.id as string;
    expect((await doctor.req({ method: 'POST', url: '/v1/me/account-deletion', body: { confirmation: 'DELETE', password: PASSWORD } })).status).toBe(200);

    const shares = (await c.req({ method: 'GET', url: `/v1/patients/${patientId}/care-shares` })).json;
    expect(shares.map((s: { status: string }) => s.status)).toEqual(['REVOKED']);
    const left = await owner.query('select id, status from app.clinical_drafts where author_user_id = $1', [doctor.userId]);
    expect(left.rows).toEqual([{ id: signedId, status: 'SIGNED' }]);
    expect(left.rows.some((r: { id: string }) => r.id === openId)).toBe(false);
    expect((await c.req({ method: 'GET', url: `/v1/patients/${patientId}/clinical-notes` })).json).toEqual([expect.objectContaining({ id: signedId, authorName: 'د. مشاركة' })]);
  });
});

describe('evaluation of clinician drafts', () => {
  /** Puts the first sentence of the notes in the first section and "Not documented." elsewhere. */
  const careful = (req: AiRequest) => {
    const msg = req.messages[0]!.content;
    const notes = msg.split('<<<\n')[1]!.split('\n>>>')[0]!;
    const first = notes.split(/(?<=[.؟!])\s/)[0]!;
    const ar = msg.includes('in Arabic');
    const props = Object.keys((req.jsonSchema!.schema as { properties: Record<string, unknown> }).properties);
    const lists = new Set(['instructions', 'whenToSeekHelp', 'checksForClinician']);
    return answer(Object.fromEntries(props.map((k, i) => [k, lists.has(k) ? (i === 0 ? [first] : []) : i === 0 ? first : ar ? 'غير موثق.' : 'Not documented.'])));
  };

  it('sends each case exactly like production and screens it with the production guard', async () => {
    const admin = await signUp(app);
    await grantRole(admin.userId, 'ADMIN');
    const reviewer = await signUp(app);
    await grantRole(reviewer.userId, 'CLINICAL_REVIEWER');
    const sonnet = (await owner.query("select id from app.ai_models where model_id = 'claude-sonnet-5-5'")).rows[0].id as string;
    const cases = (await reviewer.req({ method: 'GET', url: '/v1/admin/ai/evaluation' })).json.cases.filter((x: { routeKey: string }) => x.routeKey === 'clinician.documentation');
    expect(cases).toHaveLength(6);
    for (const x of cases) expect((await reviewer.req({ method: 'POST', url: `/v1/admin/ai/evaluation/cases/${x.id}/review`, body: { decision: 'REVIEWED' } })).status).toBe(200);
    const runOnce = async () => {
      const started = await admin.req({ method: 'POST', url: '/v1/admin/ai/evaluation/runs', body: { modelId: sonnet, routeKey: 'clinician.documentation' } });
      expect(started.status, JSON.stringify(started.json)).toBe(202);
      let run = started.json;
      for (let i = 0; i < 100 && run.status === 'RUNNING'; i++) {
        await new Promise((r) => setTimeout(r, 50));
        run = (await admin.req({ method: 'GET', url: `/v1/admin/ai/evaluation/runs/${run.id}` })).json;
      }
      return run;
    };
    script = careful;
    const good = await runOnce();
    expect(good).toMatchObject({ status: 'COMPLETED', caseCount: 6, completedCount: 6 });
    expect(good.results.filter((r: { automatedPass: boolean }) => !r.automatedPass).map((r: { caseCode: string; automatedChecks: unknown }) => [r.caseCode, r.automatedChecks])).toEqual([]);
    expect(calls[0]!.system).toContain('Nursing notes stay within nursing scope');
    script = (req) => {
      const out = JSON.parse(careful(req).text);
      const k = Object.keys(out).find((x) => typeof out[x] === 'string')!;
      return answer({ ...out, [k]: 'Start ciprofloxacin 500 mg twice daily.' });
    };
    const adding = await runOnce();
    expect(adding.results.filter((r: { automatedPass: boolean }) => !r.automatedPass).length).toBeGreaterThanOrEqual(5);
  });
});
