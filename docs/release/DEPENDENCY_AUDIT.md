# Dependency and security audit

Run `pnpm audit` and `npx expo-doctor` (in `apps/mobile`) before every release candidate and after
dependency changes. Record the outcome here.

## 2026-11-25 — Phase 9 M1

**Expo SDK 57 patch updates (8)** applied with `npx expo install --fix`, after reading each
package's official changelog on the `sdk-57` branch of github.com/expo/expo:

| Package | From → to | Changelog content |
|---|---|---|
| `expo` | 57.0.31 → 57.0.34 | bug fixes: `expo/fetch` keeps an explicit `Content-Type` with a Blob body; iOS `Response.text()` / `.arrayBuffer()` settle when a request fails after the response arrived |
| `expo-router` | 57.0.29 → 57.0.32 | bug fixes: redirects keep dynamic segments and query strings; `<Link>` keeps search params / hash with parentheses; web back after `setParams` |
| `expo-constants`, `expo-linking`, `expo-splash-screen`, `expo-image-picker`, `expo-dev-client`, `@expo/metro-runtime` | patch | version alignment only (no listed changes) |

No breaking changes, no major-version upgrade. Result: `expo-doctor` **21/21**.

**Advisories** (`pnpm audit`, before → after): 32 (9 high, 13 moderate, 10 low) → 3 (1 high, 2 moderate).

| Package | Where it runs | Action |
|---|---|---|
| `fast-uri` 3.1.8 / 4.2.2 (4 advisories each line: scheme spoofing, host confusion, path equivalence, scheme injection) | **API runtime** (Fastify's ajv compiler) | Fixed: workspace override to the patched 3.1.9 and 4.2.3 |
| `node-forge` 1.4.0 (19 advisories) | Expo CLI only (dev-server certificates); not in the app or the API | Fixed: override to 1.4.3 |
| `decode-uri-component` 0.2.2 (2: DoS on malformed percent-encoding) | App, via `expo-router` → `query-string` 7 | **Accepted, tracked.** The fix exists only in 0.5.x, which is ESM-only and breaks `query-string` 7's `require`. Impact is limited to the user's own device parsing a crafted link (denial of service of their own app, no data exposure). Re-check when `expo-router` moves to a newer `query-string`. |
| `minimatch` 10.2.6 (1: DoS via glob amplification) | ESLint only (development) | Accepted: not shipped; fixed in a major release ESLint does not use yet |

Overrides live in `pnpm-workspace.yaml` with the advisory IDs. Releases newer than a few days were
avoided where an older patched release exists (`fast-uri` 4.2.4, `node-forge` 1.4.4 were one and two
days old).

Regression after the changes: typecheck 8/8, lint 8/8, unit + API tests 505/505.

**Local test note:** after a lockfile change, run `rm -rf node_modules/.vitest-cache` before
`pnpm test` — the parallel test runs share Vite's cache in the hoisted `node_modules` and race to
clear it (`ENOTEMPTY`). A clean CI checkout has no cache and is not affected.
