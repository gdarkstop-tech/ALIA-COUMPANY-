# Security & privacy model

Medical data is treated as highly sensitive. Principle: **the application is a client of the
database's rules, not the only enforcer of them.**

## 1. Database roles

| Role | Used by | Capabilities |
| --- | --- | --- |
| `ghayarly_owner` | migrations, seed | Owns schemas/objects. Never given to the server process (production config refuses `DATABASE_URL_OWNER`). |
| `ghayarly_auth` | Better Auth | `auth` schema only (users, sessions, accounts, 2FA, rate limits). |
| `ghayarly_app` | domain API | Not owner, `NOBYPASSRLS`, `NOINHERIT`. Subject to RLS on every `app` table. Column-limited read of `auth.user` (no hashes/tokens/secrets). |

`assertRlsEffective()` runs at boot and refuses to start if the app role is superuser, has
`BYPASSRLS`, or owns any table. A test asserts this and that the owner role is rejected.

## 2. Row Level Security (summary)

- **Patients / health entries:** visible only through an `ACTIVE` `patient_access` grant. Staff
  roles have **no** blanket access to medical records. Records are never hard-deleted (no DELETE
  grant); entries are marked `ENTERED_IN_ERROR`.
- **Family access:** created only via `app.create_patient_profile()` which derives the access
  level from the date of birth: minors → `GUARDIAN_OF_MINOR`; adults → explicit consent
  attestation (`ADULT_CONSENT_ATTESTED` / `LEGAL_AUTHORITY_ATTESTED`) with the consent-statement
  version stored. Owners cannot be revoked; anyone may leave; revocations are audited.
- **Provenance:** apps can only write `PATIENT_REPORTED` / `CAREGIVER_REPORTED` (derived by a
  trigger, not chosen by the client). `PROFESSIONALLY_VERIFIED` requires verifier columns and is
  reserved for verified clinicians in an active care relationship (Milestone 3).
- **Providers:** invisible to others until `APPROVED`. Licence numbers are readable only by the
  provider and reviewers; patients see a narrow view (`public_provider_credentials`: kind, issuer,
  date). Verification transitions are enforced by trigger: providers can only submit; reviewers
  can decide; only admins can suspend/reinstate; approval requires every required credential to be
  approved; negative decisions require a reason; self-review is impossible. History rows are written
  by an owner-run trigger, so the app role cannot forge them.
- **Commerce:** `brand = 'TetraSol'` CHECK on products; `APPROVED` content requires an approval
  reference; demo items must be `demo-*`, can never be `APPROVED`, and are invisible unless the
  request context is in demo mode. Carts are private; family purchases require access to the profile.
- **Ledger and audit log:** append-only (UPDATE/DELETE blocked by trigger); the app role cannot
  insert ledger rows.
- **Wound registry (ADR 0015):** three permissions per profile in an append-only ledger; the
  scanning permission is enforced by triggers and the photo-registration function; research and
  presentation scopes are re-checked at every step. Photos are encrypted objects (AES-256-GCM, key
  bound to the object), never database rows, reachable only through 120 s HMAC-signed links that
  the server re-authorises when they are used (revocation and withdrawal kill issued links). Every
  view is audited. Wound duties are separate roles (`WOUND_RESEARCHER`, `CLINICAL_REVIEWER`,
  `PRESENTATION_APPROVER`) that cannot be self-granted; administrators get counts only. The research
  re-identification link and pseudonym key are unreadable by the application role. Test and real
  data never meet. Exports are rate-limited (`RATE_LIMITED`) and recorded with their SHA-256.

## 3. Authentication & sessions

- Better Auth (no custom crypto). Passwords ≥ 10 chars; reset tokens expire in 30 min and revoke
  all sessions. Sessions 7 days, refreshed daily; device list with revocation.
- Rate limits (Better Auth, stored in PostgreSQL): sign-in 5/min/IP (configurable; production ≤ 10),
  sign-up 5/min, OTP send 3/min, OTP verify 5/min, password reset 3/5 min, TOTP 5/min with lockout.
  Fastify adds a global 300/min/IP ceiling (Redis-backed when `REDIS_URL` is set).
- **MFA:** TOTP for doctors, nurses and all staff. `MFA_ENFORCEMENT=required` (mandatory in
  production) blocks staff endpoints without 2FA; development runs in `warn` mode with visible
  banners. Clinician-side enforcement on patient-data endpoints arrives with care teams (M3).
- **CSRF:** Better Auth origin checks explicitly enabled (it otherwise skips them under
  `NODE_ENV=test`); `/v1` state-changing requests with cookies and a foreign `Origin` or
  `Sec-Fetch-Site: cross-site` are rejected; cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in prod.
- Mobile tokens live in Keychain/Keystore (`expo-secure-store`); AsyncStorage holds preferences only.

## 4. Audit

Sensitive operations write `app.audit_log` in the same transaction: patient profile creation and
updates, health-entry changes, access revocation, role self-assignment, provider profile/capacity
changes, credential decisions, verification transitions, and reviewers viewing a submission.

## 5. Secrets & configuration

Secrets come from environment variables only (`.env` files are git-ignored; templates in
`.env.example`). Production boot fails on demo mode, dev tools, MFA warn mode, placeholder secrets
or the owner database URL. Logs redact `authorization`, `cookie` and `set-cookie`.

## 6. Synthetic data policy

Seeds and fixtures are entirely synthetic: `.test` emails, "Synthetic Demo Authority" credentials
with `DEMO-*` identifiers, placeholder TetraSol items with no therapeutic claims, ledger lines and
prices flagged `is_demo`. The seed refuses to run in production or without `DEMO_MODE=true`.

## 7. Known gaps (tracked in the implementation checklist)

- Field-level encryption for selected PHI columns, KMS-managed keys, and encrypted backups.
- Wound photos: encrypted object storage with signed, re-checked links is implemented (local
  encrypted adapter for development / tests); the **production storage provider is not configured**,
  and its key must come from a KMS before launch. Medical documents still live in the database.
- The global 300/min ceiling is keyed by IP. Behind carrier-grade NAT many people share one
  address, so busy networks could be throttled together (the E2E suite, all from one IP, meets it).
  Decision needed before launch: key authenticated traffic by session with a looser per-IP ceiling,
  measured against real traffic. Clients already retry throttled reads after a delay.
- Real payment webhook verification (HMAC) — gateway reports `NOT_CONFIGURED`.
- Care-relationship–based clinician access and consent receipts (Milestone 3).
- Penetration test, dependency scanning in CI, backup/restore drills (Milestone 6).
- The API is trusted to set `app.user_id`; RLS protects against application bugs, not against a
  fully compromised API process. Network isolation and least-privilege deployment mitigate this.
