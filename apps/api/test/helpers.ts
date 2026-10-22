import { randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import pg from 'pg';
import { loadEnv } from '../src/config/env';
import { buildServer } from '../src/server';

export const ORIGIN = 'http://localhost:8081';
export const PASSWORD = 'Test-Password-2026';

export async function createTestServer(overrides: Record<string, string> = {}): Promise<FastifyInstance> {
  const env = loadEnv({ ...process.env, ...overrides });
  const app = await buildServer(env);
  await app.ready();
  return app;
}

export function ownerPool() {
  return new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER });
}

export function uniqueEmail(prefix = 'user') {
  return `${prefix}.${randomUUID().slice(0, 8)}@example.test`;
}

function cookieHeader(setCookie: string | string[] | undefined, previous = ''): string {
  const jar = new Map(previous ? previous.split('; ').map((c) => c.split('=') as [string, string]) : []);
  for (const raw of Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) {
    const [pair] = raw.split(';');
    const idx = pair!.indexOf('=');
    jar.set(pair!.slice(0, idx), pair!.slice(idx + 1));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

export type Client = {
  userId: string;
  email: string;
  cookie: string;
  req: (opts: { method: InjectOptions['method']; url: string; body?: unknown }) => Promise<{ status: number; json: any }>;
};

export function clientFor(app: FastifyInstance, cookie: string, userId = '', email = ''): Client {
  return {
    userId,
    email,
    cookie,
    req: async ({ method, url, body }) => {
      const res = await app.inject({
        method,
        url,
        headers: { origin: ORIGIN, cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
      });
      return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
    },
  };
}

/** Accepts terms + privacy (and, optionally, explicit health-data processing) at the current versions. */
export async function grantConsents(client: Client, healthData: boolean) {
  const state = await client.req({ method: 'GET', url: '/v1/me/consents' });
  if (state.status !== 200) throw new Error(`consent state failed: ${JSON.stringify(state.json)}`);
  const wanted = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY', ...(healthData ? ['HEALTH_DATA_PROCESSING'] : [])];
  const consents = (state.json.consents as { type: string; currentVersion: string }[])
    .filter((c) => wanted.includes(c.type))
    .map((c) => ({ type: c.type, version: c.currentVersion, granted: true }));
  const r = await client.req({ method: 'POST', url: '/v1/me/consents', body: { consents, source: 'web', locale: 'en' } });
  if (r.status !== 200) throw new Error(`consent failed: ${JSON.stringify(r.json)}`);
}

export async function signUp(
  app: FastifyInstance,
  opts: { email?: string; name?: string; role?: 'PATIENT' | 'DOCTOR' | 'NURSE'; consents?: false | 'all' } = {},
): Promise<Client> {
  const email = opts.email ?? uniqueEmail();
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    payload: JSON.stringify({ email, password: PASSWORD, name: opts.name ?? 'Test User' }),
  });
  if (res.statusCode !== 200) throw new Error(`sign-up failed ${res.statusCode}: ${res.body}`);
  const body = JSON.parse(res.body);
  const client = clientFor(app, cookieHeader(res.headers['set-cookie']), body.user.id, email);
  // Same order as the app: documents are accepted before anything else is written.
  if (opts.consents !== false) await grantConsents(client, opts.role === 'PATIENT' || opts.consents === 'all');
  if (opts.role) {
    const r = await client.req({ method: 'POST', url: '/v1/me/roles', body: { role: opts.role } });
    if (r.status !== 200) throw new Error(`role assignment failed: ${JSON.stringify(r.json)}`);
  }
  return client;
}

export async function signIn(app: FastifyInstance, email: string, password = PASSWORD) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    payload: JSON.stringify({ email, password }),
  });
  return { status: res.statusCode, cookie: cookieHeader(res.headers['set-cookie']), body: res.body ? JSON.parse(res.body) : null };
}

/** Grants an internal role directly as the schema owner (simulates an admin bootstrap). */
export async function grantRole(userId: string, role: string) {
  const pool = ownerPool();
  try {
    await pool.query('insert into app.user_roles (user_id, role) values ($1, $2) on conflict do nothing', [userId, role]);
  } finally {
    await pool.end();
  }
}
