/**
 * Production photo storage (ADR 0017). Always run: activation rules (production stays
 * NOT_CONFIGURED until settings, key and approval exist), the S3 adapter's requests and error
 * mapping against a recording client, and the API's answer when storage fails (503, nothing
 * leaked). With S3_TEST_ENDPOINT (+ S3_TEST_ACCESS_KEY_ID / S3_TEST_SECRET_ACCESS_KEY) pointing at
 * a LOCAL S3-compatible server, the same API runs end to end on a real bucket protocol and the
 * bucket is verified. These are emulator results, not a cloud provider's.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ListObjectVersionsCommand, NoSuchKey, S3Client } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { WOUND_CONSENT_VERSION as V } from '@ghayarly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { createObjectStore, LocalEncryptedStore, ObjectStoreError, S3EncryptedStore, type ObjectStore, type S3StoreConfig } from '../src/integrations/storage';
import { runWoundMaintenance } from '../src/modules/wounds/routes';
import { ensureDevBucket, verifyObjectStorage } from '../src/ops/storage-verify';
import { buildServer } from '../src/server';
import { ownerPool, signUp, type Client } from './helpers';
import { testJpeg } from './wound-fixtures';

const PROD = {
  ...process.env,
  NODE_ENV: 'production',
  DEMO_MODE: 'false',
  DEV_TOOLS_ENABLED: 'false',
  MFA_ENFORCEMENT: 'required',
  AUTH_REQUIRE_EMAIL_VERIFICATION: 'true',
  DATABASE_URL_OWNER: '',
  BETTER_AUTH_SECRET: 'prod-like-secret-0123456789abcdefghijklmnopqrstuvwxyz',
  MEDIA_LINK_SECRET: 'prod-like-media-secret-0123456789abcdef',
  REDIS_URL: 'redis://redis.internal:6379',
};
const S3 = { S3_ENDPOINT: 'https://s3.eu-central-1.amazonaws.com', S3_REGION: 'eu-central-1', S3_BUCKET: 'dmw-photos', S3_ACCESS_KEY_ID: 'AKIAEXAMPLEEXAMPLE', S3_SECRET_ACCESS_KEY: 'example-secret-not-real' };
const KEY = randomBytes(32).toString('base64');

describe('activation', () => {
  it('production stays NOT_CONFIGURED until settings, encryption key, KMS key and approval all exist', () => {
    expect(createObjectStore(loadEnv(PROD))).toMatchObject({ status: 'NOT_CONFIGURED', reason: expect.stringContaining('S3_ENDPOINT') });
    expect(createObjectStore(loadEnv({ ...PROD, ...S3 })).reason).toBe('Missing OBJECT_STORAGE_KEY');
    expect(createObjectStore(loadEnv({ ...PROD, ...S3, OBJECT_STORAGE_KEY: KEY })).reason).toMatch(/S3_KMS_KEY_ID/);
    expect(createObjectStore(loadEnv({ ...PROD, ...S3, OBJECT_STORAGE_KEY: KEY, S3_KMS_KEY_ID: 'alias/dmw-photos' })).reason).toMatch(/Awaiting approval/);
    const live = createObjectStore(loadEnv({ ...PROD, ...S3, OBJECT_STORAGE_KEY: KEY, S3_KMS_KEY_ID: 'alias/dmw-photos', OBJECT_STORAGE_APPROVAL_REF: 'DPA-2026-001 / DPIA-12' }));
    expect(live).toBeInstanceOf(S3EncryptedStore);
    expect(live.status).toBe('CONFIGURED');
    // Medical images never travel over plain HTTP in production.
    expect(() => loadEnv({ ...PROD, ...S3, S3_ENDPOINT: 'http://storage.internal:9000' })).toThrow(/S3_ENDPOINT must use https/);
  });

  it('development uses the S3 adapter only when S3_* is set, otherwise the local encrypted directory', () => {
    expect(createObjectStore(loadEnv({ ...process.env, NODE_ENV: 'development' }))).toBeInstanceOf(LocalEncryptedStore);
    expect(createObjectStore(loadEnv({ ...process.env, NODE_ENV: 'development', ...S3, S3_ENDPOINT: 'http://127.0.0.1:5055' }))).toBeInstanceOf(S3EncryptedStore);
  });
});

/** An S3 client that records every command and answers from a map (or fails on demand). */
function recordingClient() {
  const objects = new Map<string, Uint8Array>();
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  let failNext: Error | null = null;
  const client = {
    send: async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: cmd.constructor.name, input: cmd.input });
      if (failNext) {
        const e = failNext;
        failNext = null;
        throw e;
      }
      const key = cmd.input.Key as string;
      if (cmd.constructor.name === 'PutObjectCommand') objects.set(key, cmd.input.Body as Uint8Array);
      if (cmd.constructor.name === 'DeleteObjectCommand') objects.delete(key);
      if (cmd.constructor.name === 'GetObjectCommand') {
        const body = objects.get(key);
        if (!body) throw new NoSuchKey({ message: 'missing', $metadata: { httpStatusCode: 404 } });
        return { Body: { transformToByteArray: async () => body } };
      }
      return {};
    },
  };
  return { client: client as unknown as S3Client, objects, sent, fail: (e: Error) => (failNext = e) };
}

const CONFIG: S3StoreConfig = { endpoint: 'https://s3.example', region: 'eu-central-1', bucket: 'dmw-photos', accessKeyId: 'a', secretAccessKey: 'b', forcePathStyle: false, sse: 'aws:kms', kmsKeyId: 'alias/dmw-photos', requestTimeoutMs: 5_000 };

describe('S3 adapter', () => {
  it('writes ciphertext with SSE-KMS and no-store, reads it back, and maps failures', async () => {
    const r = recordingClient();
    const store = new S3EncryptedStore(CONFIG, randomBytes(32), r.client);
    const key = `w/${randomUUID()}.o`;
    const plain = Buffer.from('synthetic wound photo bytes');
    await store.put(key, plain);
    const put = r.sent[0]!;
    expect(put.name).toBe('PutObjectCommand');
    expect(put.input).toMatchObject({ Bucket: 'dmw-photos', Key: key, ServerSideEncryption: 'aws:kms', SSEKMSKeyId: 'alias/dmw-photos', CacheControl: 'no-store' });
    expect(Buffer.from(put.input.Body as Uint8Array).includes(plain)).toBe(false);
    expect(await store.get(key)).toEqual(plain);

    // Moving the ciphertext to another key fails its integrity check.
    const other = `w/${randomUUID()}.o`;
    r.objects.set(other, r.objects.get(key)!);
    await expect(store.get(other)).rejects.toMatchObject({ kind: 'INTEGRITY' });
    await expect(store.get(`w/${randomUUID()}.o`)).rejects.toMatchObject({ kind: 'NOT_FOUND' });
    r.fail(Object.assign(new Error('socket hang up'), { name: 'TimeoutError' }));
    await expect(store.put(key, plain)).rejects.toBeInstanceOf(ObjectStoreError);
    // Keys the API did not generate never reach the provider.
    const before = r.sent.length;
    await expect(store.get('../../etc/passwd')).rejects.toThrow(/Invalid object key/);
    expect(r.sent.length).toBe(before);
    await store.delete(key);
    expect(r.objects.has(key)).toBe(false);
  });

  it('can rely on provider default encryption when SSE headers are not supported', async () => {
    const r = recordingClient();
    await new S3EncryptedStore({ ...CONFIG, sse: 'provider-default' }, randomBytes(32), r.client).put(`w/${randomUUID()}.o`, Buffer.from('x'));
    expect(r.sent[0]!.input.ServerSideEncryption).toBeUndefined();
  });
});

// ------------------------------------------------------------------ through the API
let owner: pg.Pool;
beforeAll(() => {
  owner = ownerPool();
});
afterAll(async () => {
  await owner.end();
});

async function internalPatientWithPhoto(app: FastifyInstance) {
  const c: Client = await signUp(app, { role: 'PATIENT', name: 'Storage Tester' });
  await owner.query("update app.user_profiles set account_kind = 'INTERNAL_TEST' where user_id = $1", [c.userId]);
  const p = await c.req({ method: 'POST', url: '/v1/patients', body: { displayName: 'Storage Tester', dateOfBirth: '1970-02-02', sex: 'MALE', relationship: 'SELF', consentBasis: 'SELF', consentAttested: true, consentStatementVersion: 'v1' } });
  expect(p.status, JSON.stringify(p.json)).toBe(201);
  expect((await c.req({ method: 'POST', url: `/v1/patients/${p.json.id}/wound-permissions`, body: { purpose: 'SCAN', action: 'GRANT', version: V } })).status).toBe(200);
  const cs = await c.req({ method: 'POST', url: '/v1/wounds', body: { patientId: p.json.id, label: 'Left heel', bodySite: 'HEEL', bodySide: 'LEFT', reportedCategory: 'DIABETIC_FOOT' } });
  expect(cs.status, JSON.stringify(cs.json)).toBe(201);
  const up = await c.req({ method: 'POST', url: `/v1/wounds/${cs.json.id}/images`, body: { contentType: 'image/jpeg', dataBase64: testJpeg(640, 480).toString('base64') } });
  expect(up.status, JSON.stringify(up.json)).toBe(201);
  const imageId = up.json.images[0].id as string;
  const link = await c.req({ method: 'POST', url: `/v1/wound-images/${imageId}/link`, body: {} });
  expect(link.status, JSON.stringify(link.json)).toBe(200);
  return { c, imageId, mediaPath: (link.json.url as string).replace(/^https?:\/\/[^/]+/, '') };
}

describe('API when storage fails', () => {
  let app: FastifyInstance;
  let dir: string;
  let failReads = false;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dmw-storage-'));
    const local = new LocalEncryptedStore(dir, randomBytes(32));
    const objects: ObjectStore = {
      status: 'DEV_ADAPTER',
      put: (k, b) => local.put(k, b),
      get: async (k) => {
        if (failReads) throw new ObjectStoreError('PROVIDER', 'Object could not be read', { cause: new Error('connect ETIMEDOUT 10.1.2.3:443 secret-bucket-name') });
        return local.get(k);
      },
      delete: (k) => local.delete(k),
    };
    app = await buildServer(loadEnv(process.env), { objects });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('answers 503 STORAGE_UNAVAILABLE without revealing the cause, and recovers', async () => {
    const { mediaPath } = await internalPatientWithPhoto(app);
    expect((await app.inject({ method: 'GET', url: mediaPath })).statusCode).toBe(200);
    failReads = true;
    const res = await app.inject({ method: 'GET', url: mediaPath });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).error.code).toBe('STORAGE_UNAVAILABLE');
    expect(res.body).not.toMatch(/ETIMEDOUT|10\.1\.2\.3|secret-bucket/);
    failReads = false;
    expect((await app.inject({ method: 'GET', url: mediaPath })).statusCode).toBe(200);
  });
});

const EMULATOR = process.env.S3_TEST_ENDPOINT;
describe.skipIf(!EMULATOR)('S3-compatible emulator, end to end (S3_TEST_ENDPOINT)', () => {
  let app: FastifyInstance;
  let store: S3EncryptedStore;
  beforeAll(async () => {
    const env = loadEnv({
      ...process.env,
      S3_ENDPOINT: EMULATOR,
      S3_REGION: 'eu-central-1',
      S3_BUCKET: `dmw-test-${randomUUID().slice(0, 8)}`,
      S3_FORCE_PATH_STYLE: 'true',
      S3_SSE: 'aws:kms',
      S3_KMS_KEY_ID: 'alias/dmw-photos-test',
      S3_ACCESS_KEY_ID: process.env.S3_TEST_ACCESS_KEY_ID ?? 'test',
      S3_SECRET_ACCESS_KEY: process.env.S3_TEST_SECRET_ACCESS_KEY ?? 'test',
      OBJECT_STORAGE_KEY: KEY,
    });
    store = createObjectStore(env) as S3EncryptedStore;
    expect(store).toBeInstanceOf(S3EncryptedStore);
    await ensureDevBucket(store);
    app = await buildServer(env, { objects: store });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
  });

  const versionsOf = async (prefix: string) => store.client.send(new ListObjectVersionsCommand({ Bucket: store.config.bucket, Prefix: prefix }));

  it('stores an uploaded photo as KMS-encrypted ciphertext, serves it only through a signed link, and deletes it', async () => {
    const { c, imageId, mediaPath } = await internalPatientWithPhoto(app);
    const listed = await versionsOf(`w/${imageId}`);
    const live = (listed.Versions ?? []).filter((v) => v.IsLatest);
    expect(live.map((v) => v.Key).sort()).toEqual([`w/${imageId}.d`, `w/${imageId}.o`]);
    const sealed = await store.getSealed(`w/${imageId}.o`);
    expect(sealed.subarray(0, 4).toString('latin1')).toBe('DMW1');
    const media = await app.inject({ method: 'GET', url: mediaPath });
    expect(media.statusCode).toBe(200);
    expect(media.rawPayload.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(media.headers['cache-control']).toBe('private, no-store');

    expect((await c.req({ method: 'DELETE', url: `/v1/wound-images/${imageId}` })).status).toBe(200);
    await runWoundMaintenance(app);
    await expect(store.get(`w/${imageId}.o`)).rejects.toMatchObject({ kind: 'NOT_FOUND' });
    expect((await app.inject({ method: 'GET', url: mediaPath })).statusCode).toBe(403);
    // Versioned bucket: a delete marker now; the old version is erased by the 30-day lifecycle rule.
    expect((await versionsOf(`w/${imageId}.o`)).DeleteMarkers?.some((m) => m.IsLatest)).toBe(true);
  });

  it('passes the bucket verification (anonymous access is checked only when the emulator enforces signatures)', async () => {
    const result = await verifyObjectStorage(store, { requireHttps: false });
    const failed = result.checks.filter((c) => !c.ok && !(c.name === 'anonymous access refused' && !process.env.S3_TEST_ENFORCES_AUTH));
    expect(failed, JSON.stringify(failed)).toEqual([]);
  });
});
