/**
 * Photo storage operations (ADR 0017).
 *   pnpm --filter @ghayarly/api storage:verify      — verify the configured bucket (canary objects only)
 *   pnpm --filter @ghayarly/api storage:dev-bucket  — create a versioned, lifecycle-managed bucket on a
 *                                                     LOCAL emulator (refused in production / remote hosts)
 */
import { loadEnv } from '../config/env';
import { createObjectStore, S3EncryptedStore } from '../integrations/storage';
import { ensureDevBucket, verifyObjectStorage } from './storage-verify';

const env = loadEnv();
const command = process.argv[2];

async function main(): Promise<number> {
  const store = createObjectStore(env);
  if (command === 'verify') {
    if (!(store instanceof S3EncryptedStore)) {
      console.log(JSON.stringify({ status: store.status, reason: store.reason ?? (store.status === 'DEV_ADAPTER' ? 'local encrypted directory (development only)' : undefined) }, null, 2));
      return 2;
    }
    const result = await verifyObjectStorage(store, { requireHttps: env.NODE_ENV === 'production' });
    for (const c of result.checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name} — ${c.detail}`);
    console.log(`\n${result.status} (${new Date().toISOString()}, bucket ${store.config.bucket}, region ${store.config.region})`);
    return result.status === 'VERIFIED' ? 0 : 1;
  }
  if (command === 'dev-bucket') {
    if (env.NODE_ENV === 'production' || !(store instanceof S3EncryptedStore)) throw new Error('dev-bucket is for a local S3 emulator in development only (set S3_*)');
    await ensureDevBucket(store);
    console.log(`bucket ${store.config.bucket} ready on ${store.config.endpoint} (versioning + infra/storage/lifecycle.json)`);
    return 0;
  }
  console.error('usage: storage-cli.ts verify | dev-bucket');
  return 64;
}

main().then(
  (code) => process.exit(code),
  (e: Error) => {
    console.error(`✗ ${e.name}: ${e.message}`);
    process.exit(1);
  },
);
