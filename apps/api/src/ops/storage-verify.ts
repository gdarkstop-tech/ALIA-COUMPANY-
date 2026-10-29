import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketVersioningCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketVersioningCommand,
  type BucketLocationConstraint,
  type LifecycleRule,
} from '@aws-sdk/client-s3';
import { ObjectStoreError, type S3EncryptedStore } from '../integrations/storage';

/**
 * Verifies a private S3-compatible bucket against ADR 0017 before it may hold patient photos.
 * Writes only synthetic canary objects under `v/`, and removes every version of them at the end.
 * Each check passes or fails on evidence returned by the bucket itself.
 */
export type StorageCheck = { name: string; ok: boolean; detail: string };
export type StorageVerification = { status: 'VERIFIED' | 'FAILED'; checks: StorageCheck[] };

const PLAINTEXT_MARKER = 'DMW-SYNTHETIC-CANARY-not-patient-data';

function objectUrl(store: S3EncryptedStore, key: string): string {
  const u = new URL(store.config.endpoint);
  if (store.config.forcePathStyle) return `${u.origin}${u.pathname.replace(/\/$/, '')}/${store.config.bucket}/${key}`;
  return `${u.protocol}//${store.config.bucket}.${u.host}${u.pathname.replace(/\/$/, '')}/${key}`;
}

export async function verifyObjectStorage(store: S3EncryptedStore, opts: { requireHttps: boolean; maxNoncurrentDays?: number }): Promise<StorageVerification> {
  const checks: StorageCheck[] = [];
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const run = async (name: string, fn: () => Promise<string>) => {
    try {
      check(name, true, await fn());
    } catch (e) {
      check(name, false, (e as Error).message);
    }
  };
  const { client, config } = store;
  const Bucket = config.bucket;
  const maxDays = opts.maxNoncurrentDays ?? 35;

  const https = config.endpoint.startsWith('https://');
  check('transport', https || !opts.requireHttps, https ? 'HTTPS endpoint' : 'plain HTTP endpoint (development emulator only)');

  await run('bucket reachable', async () => {
    await client.send(new HeadBucketCommand({ Bucket }));
    return `bucket ${Bucket} answers with these credentials`;
  });

  await run('versioning enabled (backups)', async () => {
    const v = await client.send(new GetBucketVersioningCommand({ Bucket }));
    if (v.Status !== 'Enabled') throw new Error(`versioning is ${v.Status ?? 'off'}`);
    return 'previous versions are kept for restore';
  });

  await run(`lifecycle erases old versions within ${maxDays} days`, async () => {
    const lc = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket }));
    const rules = (lc.Rules ?? []).filter((r) => r.Status === 'Enabled');
    const days = rules.map((r) => r.NoncurrentVersionExpiration?.NoncurrentDays).filter((d): d is number => typeof d === 'number');
    if (!days.length || Math.min(...days) > maxDays) throw new Error(`no enabled rule expiring noncurrent versions within ${maxDays} days`);
    if (!rules.some((r) => r.AbortIncompleteMultipartUpload?.DaysAfterInitiation)) throw new Error('no rule aborting incomplete multipart uploads');
    return `noncurrent versions expire after ${Math.min(...days)} days; incomplete uploads are aborted`;
  });

  const key = `v/${randomUUID()}.o`;
  const plain = Buffer.from(`${PLAINTEXT_MARKER} ${new Date().toISOString()}`);
  await run('write with server-side encryption', async () => {
    await store.put(key, plain);
    const head = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
    const want = config.sse;
    if (want !== 'provider-default' && head.ServerSideEncryption !== want) throw new Error(`object reports ServerSideEncryption=${head.ServerSideEncryption ?? 'none'}, expected ${want}`);
    if (want === 'aws:kms' && config.kmsKeyId && !(head.SSEKMSKeyId ?? '').includes(config.kmsKeyId.replace(/^alias\//, ''))) throw new Error(`object encrypted with ${head.SSEKMSKeyId}, expected ${config.kmsKeyId}`);
    if (head.CacheControl !== 'no-store') throw new Error('object is cacheable');
    return want === 'provider-default' ? 'provider default encryption (not reported per object)' : `${head.ServerSideEncryption}${head.SSEKMSKeyId ? ` with ${head.SSEKMSKeyId}` : ''}`;
  });

  await run('stored bytes are ciphertext (API-side AES-256-GCM)', async () => {
    const sealed = await store.getSealed(key);
    if (sealed.subarray(0, 4).toString('latin1') !== 'DMW1') throw new Error('object is not in the encrypted DMW1 format');
    if (sealed.includes(Buffer.from(PLAINTEXT_MARKER))) throw new Error('plaintext visible in storage');
    if (!(await store.get(key)).equals(plain)) throw new Error('round trip returned different bytes');
    return 'decrypts only through the API; storage holds ciphertext';
  });

  await run('anonymous access refused', async () => {
    const obj = await fetch(objectUrl(store, key), { redirect: 'manual' });
    const list = await fetch(objectUrl(store, '').replace(/\/$/, '') + '?list-type=2', { redirect: 'manual' });
    if (![401, 403, 404].includes(obj.status) || list.status === 200) throw new Error(`unsigned requests answered ${obj.status} (object) / ${list.status} (listing) — the bucket is not private`);
    return `unsigned object read → ${obj.status}, listing → ${list.status}`;
  });

  await run('ciphertext cannot be moved to another key', async () => {
    const moved = `v/${randomUUID()}.o`;
    await client.send(new CopyObjectCommand({ Bucket, Key: moved, CopySource: `${Bucket}/${key}`, ...store.encryption }));
    try {
      await store.get(moved);
      throw new Error('a copied object decrypted under another key');
    } catch (e) {
      if (!(e instanceof ObjectStoreError && e.kind === 'INTEGRITY')) throw e;
    } finally {
      await purgeAllVersions(store, moved);
    }
    return 'object key is bound into the encryption (AAD)';
  });

  await run('delete, then restore from the previous version (backup drill)', async () => {
    await store.delete(key);
    try {
      await store.get(key);
      throw new Error('object still readable after delete');
    } catch (e) {
      if (!(e instanceof ObjectStoreError && e.kind === 'NOT_FOUND')) throw e;
    }
    const versions = await client.send(new ListObjectVersionsCommand({ Bucket, Prefix: key }));
    const previous = (versions.Versions ?? []).find((v) => v.Key === key && v.VersionId);
    if (!previous) throw new Error('no previous version kept after delete');
    await client.send(new CopyObjectCommand({ Bucket, Key: key, CopySource: `${Bucket}/${key}?versionId=${encodeURIComponent(previous.VersionId!)}`, ...store.encryption }));
    if (!(await store.get(key)).equals(plain)) throw new Error('restored object differs');
    return `restored version ${previous.VersionId}`;
  });

  await run('canary removed (all versions)', async () => {
    const n = await purgeAllVersions(store, key);
    return `${n} version(s) and marker(s) removed`;
  });

  return { status: checks.every((c) => c.ok) ? 'VERIFIED' : 'FAILED', checks };
}

/** Permanently removes every version and delete marker of one verification key. */
export async function purgeAllVersions(store: S3EncryptedStore, key: string): Promise<number> {
  if (!key.startsWith('v/')) throw new Error('only verification objects can be purged here');
  const { client, config } = store;
  const listed = await client.send(new ListObjectVersionsCommand({ Bucket: config.bucket, Prefix: key }));
  const all = [...(listed.Versions ?? []), ...(listed.DeleteMarkers ?? [])].filter((v) => v.Key === key);
  for (const v of all) await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key, VersionId: v.VersionId }));
  if (!all.length) await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  return all.length;
}

/** The lifecycle rules the company applies to the production bucket (infra/storage/lifecycle.json). */
export function lifecycleRules(): LifecycleRule[] {
  return (JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../infra/storage/lifecycle.json'), 'utf8')) as { Rules: LifecycleRule[] }).Rules;
}

/**
 * Creates a bucket with versioning and the production lifecycle rules — for LOCAL emulators in
 * development and tests only. Production buckets are created by the company's infrastructure
 * (infra/storage/README.md), never by the API.
 */
export async function ensureDevBucket(store: S3EncryptedStore): Promise<void> {
  const { client, config } = store;
  const host = new URL(config.endpoint).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error(`refusing to create a bucket on a non-local host (${host})`);
  await client.send(new CreateBucketCommand({ Bucket: config.bucket, CreateBucketConfiguration: config.region === 'us-east-1' ? undefined : { LocationConstraint: config.region as BucketLocationConstraint } })).catch((e: Error) => {
    if (!/BucketAlready/.test(e.name)) throw e;
  });
  await client.send(new PutBucketVersioningCommand({ Bucket: config.bucket, VersioningConfiguration: { Status: 'Enabled' } }));
  await client.send(new PutBucketLifecycleConfigurationCommand({ Bucket: config.bucket, LifecycleConfiguration: { Rules: lifecycleRules() } }));
}
