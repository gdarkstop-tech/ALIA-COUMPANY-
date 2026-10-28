/**
 * Company-product knowledge and controlled product discovery (migration 0025, ADR 0014). The
 * ANTHROPIC slot is scripted: these tests prove the approval workflow, the keyword engine's gates
 * (approved keyword, approved indication, product on sale, flag / internal account, red flags), what
 * the model receives, and the product-claim guard on answers — not any model's judgement.
 */
import { normalizeSearch } from '@ghayarly/shared';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import type { AiProvider, AiRequest } from '../src/integrations/ai';
import { buildServer } from '../src/server';
import { grantRole, ownerPool, signUp, type Client } from './helpers';

const calls: AiRequest[] = [];
let answer = 'Keep the wound clean and covered.';
const scripted: AiProvider = {
  code: 'ANTHROPIC',
  status: 'CONFIGURED',
  complete: async (req) => {
    calls.push(req);
    return { outcome: 'ANSWERED', text: answer, servedModel: req.model, usage: { inputTokens: 900, outputTokens: 120, cacheReadTokens: 0 } };
  },
  healthCheck: async () => ({ ok: true, detail: 'scripted', checkedAt: new Date().toISOString() }),
};

let app: FastifyInstance;
let owner: pg.Pool;
let commerce: Client;
let admin: Client;
let reviewer: Client;
const run = Date.now().toString(36);
const content = (n: string) => ({
  nameAr: `تتراسول ${n}`,
  nameEn: `TetraSol ${n}`,
  summaryAr: 'جل للعناية بالجروح (اختبار)',
  summaryEn: 'Wound-care gel (test)',
  descriptionAr: 'وصف',
  descriptionEn: 'Description',
  usageAr: 'ضع طبقة رقيقة مرة يوميًا.',
  usageEn: 'Apply a thin layer once a day.',
  approvedUsesAr: 'الاستخدامات المعتمدة',
  approvedUsesEn: 'Approved uses',
  warningsAr: 'للاستخدام الخارجي فقط.',
  warningsEn: 'For external use only.',
});

/** Draft → content approved (reviewer) → published (commerce), one priced variant. */
async function liveProduct(n: string) {
  const slug = `pk-${n}-${run}`;
  const p = await commerce.req({ method: 'POST', url: '/v1/admin/catalog/products', body: { slug, brand: 'TetraSol', ...content(n) } });
  expect(p.status, JSON.stringify(p.json)).toBe(201);
  const id = p.json.id as string;
  expect((await commerce.req({ method: 'POST', url: `/v1/admin/catalog/products/${id}/variants`, body: { sku: `PK-${n}-${run}`.toUpperCase().slice(0, 40), labelAr: 'عبوة', labelEn: 'Pack', pricePiasters: 9900 } })).status).toBe(201);
  expect((await reviewer.req({ method: 'POST', url: `/v1/admin/catalog/products/${id}/approve`, body: { approvalReference: 'BRAND-LETTER-TEST' } })).status).toBe(200);
  expect((await commerce.req({ method: 'POST', url: `/v1/admin/catalog/products/${id}/publication`, body: { status: 'PUBLISHED' } })).status).toBe(200);
  return { id, slug, nameEn: `TetraSol ${n}` };
}
const INDICATION = (productId: string) => ({
  productId,
  kind: 'INDICATION',
  topic: 'pressure-ulcers',
  titleAr: 'قرح الفراش من الدرجة الأولى والثانية',
  titleEn: 'Stage 1–2 pressure ulcers',
  bodyAr: 'للمساعدة في العناية بقرح الفراش السطحية تحت إشراف ممرض.',
  bodyEn: 'Helps care for superficial pressure ulcers under a nurse’s supervision.',
  evidenceReference: 'Approved label (test) section 4.1',
});
async function entry(body: Record<string, unknown>) {
  const r = await commerce.req({ method: 'POST', url: '/v1/admin/product-knowledge/entries', body });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.id as string;
}
const submit = (id: string) => commerce.req({ method: 'POST', url: `/v1/admin/product-knowledge/entries/${id}/submit`, body: {} });
const approveEntry = (c: Client, id: string) => c.req({ method: 'POST', url: `/v1/admin/product-knowledge/entries/${id}/approve`, body: { note: 'Checked against the approved label' } });
async function liveEntry(body: Record<string, unknown>) {
  const id = await entry(body);
  await submit(id);
  expect((await approveEntry(reviewer, id)).json.status).toBe('APPROVED');
  return id;
}
async function keyword(body: Record<string, unknown>) {
  const r = await commerce.req({ method: 'POST', url: '/v1/admin/product-knowledge/keywords', body: { locale: 'en', variant: 'KEYWORD', ...body } });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.id as string;
}
const approveKeyword = (c: Client, id: string) => c.req({ method: 'POST', url: `/v1/admin/product-knowledge/keywords/${id}/approve`, body: {} });

async function person(internal: boolean) {
  const c = await signUp(app, { role: 'PATIENT' });
  await c.req({ method: 'GET', url: '/v1/me' });
  if (internal) await owner.query("update app.user_profiles set account_kind = 'INTERNAL_TEST' where user_id = $1", [c.userId]);
  const state = await c.req({ method: 'GET', url: '/v1/me/consents' });
  const ai = state.json.consents.find((x: { type: string }) => x.type === 'AI_ASSISTANT_PROCESSING');
  await c.req({ method: 'POST', url: '/v1/me/consents', body: { consents: [{ type: ai.type, version: ai.currentVersion, granted: true }], source: 'web', locale: 'en' } });
  return c;
}
async function ask(c: Client, content: string) {
  const conv = (await c.req({ method: 'POST', url: '/v1/ai/conversations', body: {} })).json.id as string;
  const r = await c.req({ method: 'POST', url: `/v1/ai/conversations/${conv}/messages`, body: { content } });
  return { conv, r };
}
const preview = async (c: Client, q: string) => (await c.req({ method: 'GET', url: `/v1/admin/product-knowledge/preview?q=${encodeURIComponent(q)}` })).json as { productId: string; match: string; term: string }[];
/** app.product_discovery as a given person (it reads the session's user, like the API does). */
async function discoveryAs(userId: string, q: string) {
  const conn = await app.services.pools.appPool.connect();
  try {
    await conn.query('begin');
    await conn.query("select set_config('app.user_id', $1, true)", [userId]);
    return (await conn.query('select product_id from app.product_discovery($1, 2)', [q])).rows;
  } finally {
    await conn.query('rollback');
    conn.release();
  }
}
const usage = async (userId: string) => (await owner.query("select status, outcome, cost_micros::int as cost from app.ai_usage where user_id = $1 and route_key = 'patient.chat' order by reserved_at", [userId])).rows;

beforeAll(async () => {
  app = await buildServer(loadEnv(process.env), { ai: { ANTHROPIC: scripted } });
  await app.ready();
  owner = ownerPool();
  commerce = await signUp(app);
  await grantRole(commerce.userId, 'COMMERCE_MANAGER');
  admin = await signUp(app);
  await grantRole(admin.userId, 'ADMIN');
  reviewer = await signUp(app);
  await grantRole(reviewer.userId, 'CLINICAL_REVIEWER');
  await owner.query("update app.ai_models set price_verified_at = now(), active = true where model_id = 'claude-opus-5-5'");
  await owner.query("update app.ai_routes set enabled = true where key = 'patient.chat'");
  await owner.query('update app.ai_budget set monthly_limit_micros = 50000000');
});
beforeEach(() => {
  calls.length = 0;
  answer = 'Keep the wound clean and covered.';
});
afterAll(async () => {
  await owner.query("update app.ai_routes set enabled = false where key = 'patient.chat'");
  await owner.query('update app.ai_budget set monthly_limit_micros = null');
  await owner.query("update app.ai_models set active = false, price_verified_at = null where model_id = 'claude-opus-5-5'");
  await owner.end();
  await app.close();
});

describe('approval workflow', () => {
  it('only a clinical reviewer who did not write it approves; commercial staff and admins cannot; versions are immutable', async () => {
    const p = await liveProduct('wf');
    const id = await entry(INDICATION(p.id));
    expect((await approveEntry(reviewer, id)).json.error.code).toBe('INVALID_TRANSITION'); // submit first
    expect((await submit(id)).json.status).toBe('IN_REVIEW');
    expect((await approveEntry(commerce, id)).status).toBe(403);
    expect((await approveEntry(admin, id)).json.error.code).toBe('PERMISSION_REQUIRED'); // admins are not clinical reviewers
    const ok = await approveEntry(reviewer, id);
    expect(ok.json).toMatchObject({ status: 'APPROVED', live: { version: 1, approvedByMe: true } });

    // Editing makes a new draft; version 1 stays live until the new text is approved.
    const edited = await commerce.req({ method: 'PATCH', url: `/v1/admin/product-knowledge/entries/${id}`, body: { bodyEn: 'Helps care for superficial pressure ulcers (stage 1–2).' } });
    expect(edited.json).toMatchObject({ status: 'DRAFT', live: { version: 1 } });
    await expect(owner.query("update app.product_knowledge_versions set body_en = 'changed' where entry_id = $1", [id])).rejects.toThrow(/append-only/);
    const audit = await owner.query("select count(*)::int as n from app.audit_log where action = 'product.knowledge.approved' and entity_id = $1", [id]);
    expect(audit.rows[0].n).toBe(1);

    // Kind and product never change; demo products cannot carry approved knowledge.
    const demo = (
      await owner.query(
        "insert into app.products (slug, name_ar, name_en, summary_ar, summary_en, description_ar, description_en, usage_ar, usage_en, is_demo) values ($1, 'تجريبي', 'Demo', 's', 's', 'd', 'd', 'u', 'u', true) returning id",
        [`demo-pk-${run}`],
      )
    ).rows[0].id as string;
    expect((await commerce.req({ method: 'POST', url: '/v1/admin/product-knowledge/entries', body: INDICATION(demo) })).json.error.code).toBe('DEMO_PRODUCT');
    expect((await commerce.req({ method: 'POST', url: '/v1/admin/product-knowledge/entries', body: { ...INDICATION(p.id), topic: null } })).status).toBe(400);
  });

  it('keywords need their own clinical approval and can only point at an indication of the same product', async () => {
    const p = await liveProduct('kw');
    const other = await liveProduct('kw2');
    const ind = await liveEntry(INDICATION(p.id));
    expect((await commerce.req({ method: 'POST', url: '/v1/admin/product-knowledge/keywords', body: { productId: other.id, indicationId: ind, term: 'bed sore', locale: 'en', variant: 'SYNONYM' } })).json.error.code).toBe('INDICATION_MISMATCH');
    const kw = await keyword({ productId: p.id, indicationId: ind, term: 'Bed sore', variant: 'SYNONYM' });
    expect((await approveKeyword(commerce, kw)).status).toBe(403);
    expect((await approveKeyword(admin, kw)).json.error.code).toBe('PERMISSION_REQUIRED');
    const ok = await approveKeyword(reviewer, kw);
    expect(ok.json).toMatchObject({ status: 'APPROVED', active: true, indicationTitle: 'Stage 1–2 pressure ulcers' });
    // Terms are never edited in place (retire and add a new one).
    await expect(
      (async () => {
        const conn = await app.services.pools.appPool.connect();
        try {
          await conn.query('begin');
          await conn.query("select set_config('app.user_id', $1, true)", [commerce.userId]);
          await conn.query("update app.product_keywords set term = 'anything' where id = $1", [kw]);
        } finally {
          await conn.query('rollback');
          conn.release();
        }
      })(),
    ).rejects.toThrow();
    // A reviewer who proposed nothing cannot propose either (proposals come from catalogue staff).
    expect((await reviewer.req({ method: 'POST', url: '/v1/admin/product-knowledge/keywords', body: { productId: p.id, term: 'pressure sore', locale: 'en', variant: 'SYNONYM' } })).status).toBe(403);
  });
});

describe('keyword engine', () => {
  it('surfaces a product only through an approved keyword with a live indication, for a product on sale', async () => {
    const p = await liveProduct('eng');
    const ind = await entry(INDICATION(p.id));
    const kw = await keyword({ productId: p.id, indicationId: ind, term: 'pressure ulcer' });
    const ar = await keyword({ productId: p.id, indicationId: ind, term: 'قرحة الفراش', locale: 'ar' });
    const typo = await keyword({ productId: p.id, indicationId: ind, term: 'pressure ulser', variant: 'MISSPELLING' });
    const q = 'My father has a pressure ulcer on his heel, how do I care for it?';
    expect(await preview(reviewer, q)).toEqual([]); // keyword pending
    await approveKeyword(reviewer, kw);
    expect(await preview(reviewer, q)).toEqual([]); // indication not approved yet
    await submit(ind);
    await approveEntry(reviewer, ind);
    expect(await preview(reviewer, q)).toEqual([expect.objectContaining({ productId: p.id, match: 'INDICATION', term: 'pressure ulcer' })]);
    await approveKeyword(reviewer, ar);
    await approveKeyword(reviewer, typo);
    // Arabic with the attached article and diacritics, and a curated misspelling.
    expect(await preview(reviewer, 'والدي عنده قُرحة فراش في الكعب')).toHaveLength(1);
    expect(await preview(reviewer, 'pressure ulser care')).toHaveLength(1);
    // Whole words only.
    expect(await preview(reviewer, 'pressure ulcers')).toEqual([]);

    // Retiring the indication stops it at once; unpublishing the product too.
    await reviewer.req({ method: 'POST', url: `/v1/admin/product-knowledge/entries/${ind}/retire`, body: { note: 'Label withdrawn (test)' } });
    expect(await preview(reviewer, q)).toEqual([]);
    const ind2 = await liveEntry({ ...INDICATION(p.id), titleEn: 'Pressure ulcers (renewed)' });
    const kw2 = await keyword({ productId: p.id, indicationId: ind2, term: 'pressure ulcer' });
    await approveKeyword(reviewer, kw2);
    expect(await preview(reviewer, q)).toHaveLength(1);
    expect((await commerce.req({ method: 'POST', url: `/v1/admin/catalog/products/${p.id}/publication`, body: { status: 'UNPUBLISHED' } })).status).toBe(200);
    expect(await preview(reviewer, q)).toEqual([]);
  });

  it('normalises Arabic and English exactly like the database', async () => {
    const samples = ['قُرحة الفراش', 'بالأمس، أُصيبَ بحرقٍ!', 'TetraSol® Gel — 100%', 'ﻻ', 'والقدم السكري', 'إصابة ٣ سم'];
    const r = await owner.query('select app.search_normalize(x) as n from unnest($1::text[]) with ordinality as t(x, i) order by i', [samples]);
    expect(samples.map(normalizeSearch)).toEqual(r.rows.map((x) => x.n));
  });
});

describe('product discovery in the assistant', () => {
  let product: { id: string; slug: string; nameEn: string };
  let other: { id: string; slug: string; nameEn: string };
  let indicationVersion: string;
  beforeAll(async () => {
    product = await liveProduct('chat');
    other = await liveProduct('other');
    const ind = await liveEntry(INDICATION(product.id));
    await liveEntry({ productId: product.id, kind: 'CONTRAINDICATION', titleAr: 'لا يُستخدم', titleEn: 'Do not use', bodyAr: 'على الجروح العميقة أو الملتهبة.', bodyEn: 'On deep or infected wounds.', evidenceReference: 'Approved label (test) section 4.3' });
    await liveEntry({ productId: product.id, kind: 'CLAIM', titleAr: 'عبارة', titleEn: 'Statement', bodyAr: 'خفيف على الجلد.', bodyEn: 'Gentle on the skin; clinically tested on 40 volunteers.', evidenceReference: 'Study report (test) 2025-07' });
    await approveKeyword(reviewer, await keyword({ productId: product.id, indicationId: ind, term: 'bedsore' }));
    await approveKeyword(reviewer, await keyword({ productId: product.id, indicationId: ind, term: 'قرحة الفراش', locale: 'ar' }));
    await approveKeyword(reviewer, await keyword({ productId: product.id, term: 'tetrasol chat gel', variant: 'SYNONYM' }));
    indicationVersion = (await owner.query('select id from app.product_knowledge_versions where entry_id = $1 and superseded_at is null', [ind])).rows[0].id;
  });

  it('is off for everyone while the flag is off; internal test accounts get approved information as labelled data', async () => {
    const standard = await person(false);
    const tester = await person(true);
    expect(await discoveryAs(standard.userId, 'How do I look after a bedsore?')).toEqual([]);
    expect(await discoveryAs(tester.userId, 'How do I look after a bedsore?')).toEqual([{ product_id: product.id }]);
    await expect(owner.query("update app.feature_flags set enabled = true where key = 'ai.product_discovery'")).rejects.toThrow(/regulated_feature_needs_evidence/);

    answer = 'Keep it clean and relieve pressure. One option to discuss with your nurse is [P1], approved for superficial pressure ulcers; it is for external use only and not for deep or infected wounds.';
    const { conv, r } = await ask(tester, 'My mother has a bedsore. How do I look after it?');
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const extra = calls.at(-1)!.systemExtra!;
    expect(extra).toContain('Company product information:');
    expect(extra).toContain(`[P1] ${product.nameEn} (TetraSol)`);
    expect(extra).toContain('Approved use: Stage 1–2 pressure ulcers');
    expect(extra).toContain('Do not use: Do not use — On deep or infected wounds.');
    expect(extra).toContain('Warnings: For external use only.');
    expect(r.json.message.products).toEqual([expect.objectContaining({ label: 'P1', productId: product.id, slug: product.slug, indication: expect.objectContaining({ versionId: indicationVersion, titleEn: 'Stage 1–2 pressure ulcers' }) })]);
    // The card stays with the conversation, and only with the person's own conversation.
    const detail = (await tester.req({ method: 'GET', url: `/v1/ai/conversations/${conv}` })).json;
    expect(detail.messages.at(-1).products).toHaveLength(1);
    expect((await standard.req({ method: 'GET', url: `/v1/ai/conversations/${conv}` })).status).toBe(404);
  });

  it('never uses the profile or earlier messages, never offers products when signs need a clinician, and shows a card only when cited', async () => {
    const tester = await person(true);
    // Only the current words count: a later question about something else gets nothing.
    const conv = (await tester.req({ method: 'POST', url: '/v1/ai/conversations', body: {} })).json.id as string;
    await tester.req({ method: 'POST', url: `/v1/ai/conversations/${conv}/messages`, body: { content: 'My mother has a bedsore.' } });
    calls.length = 0;
    await tester.req({ method: 'POST', url: `/v1/ai/conversations/${conv}/messages`, body: { content: 'What should she eat to stay strong?' } });
    expect(calls[0]!.systemExtra ?? '').not.toContain('[P1]');

    // Red flags: product information is withheld.
    calls.length = 0;
    const flagged = await ask(tester, 'Her bedsore has pus and a bad smell, what can I put on it?');
    expect(flagged.r.status).toBe(200);
    expect(calls[0]!.systemExtra ?? '').not.toContain('[P1]');
    calls.length = 0;
    expect((await ask(tester, 'عندها قرحة الفراش، أعمل لها إيه؟')).r.status).toBe(200);
    expect(calls[0]!.systemExtra).toContain('[P1]');
    calls.length = 0;
    expect((await ask(tester, 'قرحة الفراش فيها صديد وريحة وحشة')).r.status).toBe(200);
    expect(calls[0]!.systemExtra ?? '').not.toContain('[P1]');

    // Offered but not cited: no card.
    answer = 'Relieve pressure, keep the skin clean and dry, and ask her nurse to check it.';
    const quiet = await ask(tester, 'How do I care for a bedsore?');
    expect(quiet.r.json.message.products).toEqual([]);
    expect(calls.at(-1)!.systemExtra).toContain('[P1]');
  });

  it('rejects answers that name unoffered products or make unapproved claims — paid, not counted, 5 a day', async () => {
    const tester = await person(true);
    const before = (await tester.req({ method: 'GET', url: '/v1/ai/assistant' })).json.allowance.used;
    // An approved statement may be repeated ("clinically tested"); an unapproved one may not.
    answer = '[P1] is gentle on the skin and was clinically tested on 40 volunteers. Always follow its warnings.';
    expect((await ask(tester, 'Tell me about tetrasol chat gel')).r.status).toBe(200);
    const bad: [string, string][] = [
      ['[P1] cures bedsores within a week.', 'How do I treat a bedsore?'],
      ['For burns, the best product is [P1] — it heals all wounds.', 'What about a bedsore?'],
      ['منتج [P1] يشفي قرحة الفراش ومضمون.', 'ماذا أفعل مع bedsore؟'],
      [`Keep it clean. [P1] is one option.\nAnother option is ${other.nameEn}.`, 'Is there anything for a bedsore?'],
    ];
    for (const [text, q] of bad) {
      answer = text;
      const { r } = await ask(tester, q);
      expect(r.status, text).toBe(502);
      expect(r.json.error.code).toBe('AI_ANSWER_REJECTED');
    }
    // Naming a company product when none was offered is rejected too.
    answer = `Many people use ${product.nameEn} for this.`;
    expect((await ask(tester, 'How should I clean a small cut?')).r.json.error.code).toBe('AI_ANSWER_REJECTED');
    const u = await usage(tester.userId);
    expect(u.filter((x) => x.outcome === 'INVALID_OUTPUT')).toHaveLength(5);
    expect(u.filter((x) => x.outcome === 'INVALID_OUTPUT').every((x) => x.status === 'RELEASED' && x.cost > 0)).toBe(true);
    expect((await tester.req({ method: 'GET', url: '/v1/ai/assistant' })).json.allowance.used).toBe(before + 1);
    // Five a day: the assistant pauses for this person until tomorrow.
    answer = 'Keep it clean.';
    const capped = await ask(tester, 'How do I clean a scrape?');
    expect(capped.r.status).toBe(429);
    expect(capped.r.json.error.code).toBe('AI_ANSWER_LIMIT');
  });

  it('shows only live approved statements in the store, and drops withdrawn products from earlier answers', async () => {
    const tester = await person(true);
    const detail = (await tester.req({ method: 'GET', url: `/v1/store/products/${product.slug}` })).json;
    expect(detail.knowledge.map((k: { kind: string }) => k.kind)).toEqual(['INDICATION', 'CONTRAINDICATION', 'CLAIM']);
    const draft = await entry({ productId: product.id, kind: 'FAQ', titleAr: 'سؤال', titleEn: 'Question?', bodyAr: 'جواب', bodyEn: 'Answer', evidenceReference: 'FAQ draft (test)' });
    expect((await tester.req({ method: 'GET', url: `/v1/store/products/${product.slug}` })).json.knowledge).toHaveLength(3);
    expect((await tester.req({ method: 'GET', url: '/v1/admin/product-knowledge' })).status).toBe(403);

    answer = 'Ask her nurse about [P1], approved for superficial pressure ulcers; for external use only.';
    const { conv, r } = await ask(tester, 'Anything for a bedsore?');
    expect(r.json.message.products).toHaveLength(1);
    expect((await commerce.req({ method: 'POST', url: `/v1/admin/catalog/products/${product.id}/publication`, body: { status: 'UNPUBLISHED' } })).status).toBe(200);
    const later = (await tester.req({ method: 'GET', url: `/v1/ai/conversations/${conv}` })).json;
    expect(later.messages.at(-1).products).toEqual([]);
    await commerce.req({ method: 'POST', url: `/v1/admin/catalog/products/${product.id}/publication`, body: { status: 'PUBLISHED' } });
    expect(draft).toBeTruthy();
  });
});
