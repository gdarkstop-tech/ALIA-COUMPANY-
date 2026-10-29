#!/usr/bin/env node
// Load test for the rate-limit policy (ADR 0016) against running API instances that share Redis.
// Development data only (seeded demo accounts); never point it at production.
//
//   node scripts/load/rate-limit-load.mjs --api http://localhost:4000 [--api http://localhost:4001] [--ceiling]
//
// Every request leaves from this machine, i.e. ONE client IP — the carrier-NAT situation:
//   A. many signed-in people behind one address  → expect no throttling (per-account counting)
//   B. one person bursting past the per-account limit → 429 + Retry-After for that person only
//   C. an anonymous flood → throttled per IP
//   D. (--ceiling) a flood past the per-IP ceiling → even a fresh account is refused
// With two --api URLs, requests alternate between instances: limits must hold across both.
const args = process.argv.slice(2);
const apis = args.flatMap((a, i) => (a === '--api' ? [args[i + 1]] : []));
if (!apis.length) apis.push('http://localhost:4000');
const withCeiling = args.includes('--ceiling');
const ORIGIN = 'http://localhost:8081';
const PASSWORD = 'DressMyWound-Demo-2026';
const ACCOUNTS = ['patient.demo', 'doctor.demo', 'nurse.demo', 'admin.demo', 'ai.tester', 'clinician.tester', 'reviewer.demo', 'wound.tester', 'wound.presenter', 'wound.approver', 'wound.researcher', 'wound.reviewer'].map((n) => `${n}@demo.ghayarly.test`);

let rr = 0;
const nextApi = () => apis[rr++ % apis.length];

async function send(path, cookie) {
  const started = performance.now();
  const res = await fetch(`${nextApi()}${path}`, { headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) } });
  await res.arrayBuffer();
  return { status: res.status, retryAfter: res.headers.get('retry-after'), ms: performance.now() - started };
}

async function pool(tasks, concurrency) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (i < tasks.length) {
      const t = tasks[i++];
      out.push(await t());
    }
  }));
  return out;
}

function summary(label, results) {
  const ok = results.filter((r) => r.status < 400).length;
  const limited = results.filter((r) => r.status === 429);
  const other = results.filter((r) => r.status >= 400 && r.status !== 429);
  const lat = results.map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p) => lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))]?.toFixed(1);
  const ra = [...new Set(limited.map((r) => r.retryAfter))].slice(0, 5);
  console.log(`${label}: ${results.length} requests → ${ok} ok, ${limited.length} × 429 (Retry-After seen: ${ra.join(', ') || '—'}), ${other.length} other errors; latency p50 ${pct(50)} ms, p95 ${pct(95)} ms`);
  return { ok, limited: limited.length, other: other.length };
}

async function signIn(email) {
  const res = await fetch(`${apis[0]}/api/auth/sign-in/email`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (!res.ok) throw new Error(`sign-in ${email}: ${res.status} ${await res.text()}`);
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

const verdicts = [];
const expect = (cond, text) => { verdicts.push([cond, text]); console.log(`${cond ? '✓' : '✗'} ${text}`); };

console.log(`instances: ${apis.join(', ')}`);
const cookies = [];
for (const email of ACCOUNTS) cookies.push(await signIn(email));
console.log(`signed in ${cookies.length} demo accounts (one client IP)`);

// A. 12 people × 40 reads = 480 requests in a burst from one IP (above the old 300/min/IP ceiling).
const a = summary('A carrier NAT', await pool(cookies.flatMap((c) => Array.from({ length: 40 }, () => () => send('/v1/me', c))), 24));
expect(a.limited === 0 && a.other === 0, 'A: 12 accounts behind one IP are never throttled (480 requests > old 300/IP)');

// B. one account bursts 700 reads; another account keeps working meanwhile.
const heavy = cookies[0];
const b = summary('B heavy account', await pool(Array.from({ length: 700 }, () => () => send('/v1/me', heavy)), 24));
expect(b.limited > 0 && b.ok <= 600, `B: the bursting account is limited (≤ 600/min across ${apis.length} instance(s)): ${b.ok} ok`);
const bystander = await send('/v1/me', cookies[1]);
expect(bystander.status === 200, 'B: another account on the same IP is unaffected');

// C. anonymous flood: 400 status reads.
const c = summary('C anonymous flood', await pool(Array.from({ length: 400 }, () => () => send('/v1/system/status')), 24));
expect(c.limited > 0 && c.ok <= 300, `C: anonymous traffic limited per IP (≤ 300/min): ${c.ok} ok`);

if (withCeiling) {
  // D. push the address past the 6000/min ceiling with cheap anonymous requests.
  const d = summary('D ceiling flood', await pool(Array.from({ length: 6200 }, () => () => send('/v1/system/status')), 48));
  const fresh = await send('/v1/me', cookies[11]);
  expect(d.limited > 0 && fresh.status === 429, `D: past the per-IP ceiling even an unused account is refused (status ${fresh.status}, Retry-After ${fresh.retryAfter})`);
}

const failed = verdicts.filter(([ok]) => !ok).length;
console.log(failed ? `${failed} expectation(s) failed` : 'all expectations met');
process.exit(failed ? 1 : 0);
