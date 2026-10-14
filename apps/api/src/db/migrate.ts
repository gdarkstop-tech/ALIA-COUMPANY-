import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../db/migrations');

/**
 * Minimal, explicit SQL migration runner. Each file runs in its own transaction as the schema
 * owner; applied files are checksummed so an edited, already-applied migration fails loudly.
 */
export async function runMigrations(ownerUrl: string, log: (line: string) => void = console.log): Promise<string[]> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS meta;
      CREATE TABLE IF NOT EXISTS meta.schema_migrations (
        version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    await client.query('SELECT pg_advisory_lock(727274)');
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const { rows } = await client.query<{ version: string; checksum: string }>('SELECT version, checksum FROM meta.schema_migrations');
    const done = new Map(rows.map((r) => [r.version, r.checksum]));
    for (const file of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = done.get(file);
      if (previous) {
        if (previous !== checksum) throw new Error(`Migration ${file} was modified after being applied (checksum mismatch)`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO meta.schema_migrations (version, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
        applied.push(file);
        log(`✓ applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }
    if (!applied.length) log('✓ database schema is up to date');
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => undefined);
    await client.end();
  }
  return applied;
}

/** Drops every schema this project owns. Development/test only. */
export async function dropAll(ownerUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS meta CASCADE;');
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) {
    console.error('DATABASE_URL_OWNER is required to run migrations');
    process.exit(1);
  }
  runMigrations(url).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
