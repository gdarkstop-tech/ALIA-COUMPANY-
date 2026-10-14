import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Env } from '../config/env';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type Pools = { appPool: pg.Pool; authPool: pg.Pool };

export function createPools(env: Env): Pools {
  const appPool = new pg.Pool({ connectionString: env.DATABASE_URL_APP, max: 20, application_name: 'ghayarly-api' });
  const authPool = new pg.Pool({
    connectionString: env.DATABASE_URL_AUTH,
    max: 10,
    application_name: 'ghayarly-auth',
    options: '-c search_path=auth',
  });
  return { appPool, authPool };
}

export function createDb(appPool: pg.Pool): Db {
  return drizzle(appPool, { schema });
}

export type RequestContext = { userId: string | null; demoMode: boolean; requestId?: string };

/**
 * Runs `fn` in a transaction whose RLS context is the authenticated user. The settings are
 * transaction-local (`set_config(..., true)`), so they can never leak to another request that
 * later reuses the pooled connection.
 */
export async function withContext<T>(db: Db, ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.user_id', ${ctx.userId ?? ''}, true), set_config('app.demo_mode', ${ctx.demoMode ? 'on' : 'off'}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Boot-time guard: the domain connection must be subject to RLS. Refuses to start if the
 * configured role is a superuser, has BYPASSRLS, or owns any table in the `app` schema.
 */
export async function assertRlsEffective(appPool: pg.Pool): Promise<void> {
  const { rows } = await appPool.query<{ rolsuper: boolean; rolbypassrls: boolean; owned: string }>(`
    select r.rolsuper, r.rolbypassrls,
           (select count(*) from pg_tables t where t.schemaname in ('app','auth') and t.tableowner = current_user)::text as owned
    from pg_roles r where r.rolname = current_user`);
  const row = rows[0];
  if (!row) throw new Error('Unable to inspect database role');
  if (row.rolsuper || row.rolbypassrls || row.owned !== '0') {
    throw new Error(
      `Refusing to start: DATABASE_URL_APP role bypasses Row Level Security (superuser=${row.rolsuper}, bypassrls=${row.rolbypassrls}, ownedTables=${row.owned}).`,
    );
  }
}
