import { loadEnv } from '../config/env';
import { dropAll, runMigrations } from './migrate';
import { seed } from './seed';

/** Development only: drop all project schemas, re-run migrations and re-seed synthetic data. */
const env = loadEnv();
if (env.NODE_ENV === 'production') throw new Error('db:reset is forbidden in production');
if (!env.DATABASE_URL_OWNER) throw new Error('DATABASE_URL_OWNER is required');
await dropAll(env.DATABASE_URL_OWNER);
console.log('✓ dropped schemas');
await runMigrations(env.DATABASE_URL_OWNER);
if (env.DEMO_MODE) await seed();
