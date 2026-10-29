# ADR 0016 — Rate limits: per account, per-IP ceiling, strict authentication limits

- Status: accepted (2026-10-29)
- Supersedes: the single global 300 requests/min/IP ceiling (SECURITY.md §3, known gap of 2026-10-29)
- Code: `apps/api/src/lib/rate-limits.ts`, `apps/api/src/lib/rateLimitKey.ts`, `apps/api/src/server.ts`, `apps/api/src/auth/auth.ts`; clients `packages/api-client` (`retryAfterSeconds`, `throttleDelayMs`)
- Tests: `apps/api/test/rate-limits.test.ts`; load test `scripts/load/rate-limit-load.mjs`

## Context
Egyptian mobile carriers put many subscribers behind one carrier-grade NAT address. The previous
global limit — 300 requests per minute per IP — meant that a few busy people on one network could
throttle everyone else on it, and the E2E suite (one IP) hit it regularly. Limits must still stop
credential stuffing, scraping, upload and AI abuse, and floods from one address with many accounts.

## Decision
Four layers, each answering `429 RATE_LIMITED` with an accurate `Retry-After` (seconds):

| Layer | Key | Default limit | Where |
|---|---|---|---|
| 1. Per-IP ceiling, all traffic | proxy-resolved client IP | 6 000 / min (`RATE_LIMIT_IP_CEILING_PER_MIN`) | `onRequest` hook, runs **before** any session lookup |
| 2. General API | signed-in: **account**; anonymous: IP | 600 / min per account (`RATE_LIMIT_ACCOUNT_PER_MIN`), 300 / min per anonymous IP (`RATE_LIMIT_ANON_IP_PER_MIN`) | `@fastify/rate-limit` (global) |
| 3. Sensitive and expensive routes | account | e.g. AI messages 20/min, voice sessions 6/min, document reading 6/min, uploads 20/min, wound exports 3–6/min | per-route config (unchanged) |
| 3b. Daily allowances | account | 200 photo + document uploads / 24 h (`UPLOADS_PER_ACCOUNT_PER_DAY`), counted after validation | `consumeAllowance` |
| 4. Authentication | IP (Better Auth, PostgreSQL counters) | sign-in 5/min (≤ 10 in production), sign-up 5/min, OTP send 3/min, OTP verify 5/min, password reset 3/5 min, TOTP 5/min | `auth.ts`, **unchanged** |

AI is additionally bounded by weekly per-person quotas and the company budget (ADR 0007); those
are not rate limits and are untouched.

- **Distributed counters.** Layers 1–3 count in Redis (one atomic `INCR`/`PEXPIRE` script per hit),
  so every API instance shares them. `REDIS_URL` is now **required in production** (the server
  refuses to start without it). If Redis becomes unreachable, the ceiling and allowances count in
  the instance's memory (still enforced per instance) instead of failing open; the general limiter
  is skipped for that request.
- **Client IP.** Fastify trusts exactly `TRUST_PROXY_HOPS` proxies in production (never the whole
  `X-Forwarded-For`), and Better Auth receives only that resolved address — a client cannot mint a
  new key by sending forwarding headers (tested).
- **Clients.** The shared API client exposes `retryAfterSeconds`; the app and console repeat a
  throttled **read** after the server's `Retry-After` plus up to 25 % jitter (≤ 60 s, at most 3–4
  times). Writes are never replayed automatically — the person sees "too many attempts" and decides.
  CORS exposes `Retry-After` to browser clients.
- **Distributed abuse** (many IPs, many accounts): layer 2 caps each account; account creation is
  capped per IP by Better Auth; AI and uploads are capped per account. Volumetric attacks across many
  addresses belong to the edge (CDN/WAF rate rules, bot management) in front of the API — an
  infrastructure item for the hosting decision.

## Measured (2026-10-29, development, two API instances on one Redis, one client IP)
`node scripts/load/rate-limit-load.mjs --api http://localhost:4000 --api http://localhost:4001 --ceiling`

| Scenario | Result |
|---|---|
| A. 12 accounts × 40 reads from one IP (480 > old 300/IP) | 480 ok, 0 × 429; p50 107 ms, p95 336 ms |
| B. one account bursts 700 reads across both instances | 560 ok (+40 in A = 600 shared across instances), 140 × 429 with Retry-After 55–56 s; another account on the same IP unaffected |
| C. 400 anonymous reads | 288 ok (+12 sign-ins = 300), 112 × 429 |
| D. flood past the 6 000/min ceiling | an unused account is refused (429, Retry-After 47 s) |

These figures come from a development laptop-class container (tsx, no clustering). They prove the
policy, not production capacity; production limits should be re-tuned from real traffic metrics.

## Consequences
- People on shared carrier addresses are no longer throttled by each other.
- One address can still not exceed the ceiling, whatever the number of accounts or forged cookies.
- Every limit is configurable per environment; production keeps the strict authentication limits.

## Rejected alternatives
- *Keying on a client-supplied device ID header* — trivially rotated by an attacker.
- *Raising the per-IP limit only* — still lets one busy network block others, and weakens flood protection.
- *Failing closed when Redis is down* — would take the whole API down with the cache.
