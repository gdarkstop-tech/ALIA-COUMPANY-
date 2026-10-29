# ADR 0015 — Wound Intelligence Registry: three permissions, photo vault, research and presentations

- Status: accepted (2026-10-29) — implemented; **every wound flag OFF** pending the approvals listed below
- Extends: [ADR 0002](0002-rls-role-separation.md), [ADR 0005](0005-family-consent-model.md), [ADR 0006](0006-tetrasol-only-store-and-demo-isolation.md), [ADR 0013](0013-record-shares-clinician-copilot.md)
- Code: migrations `0026_wound_registry_roles.sql`, `0027_wound_registry.sql`; `apps/api/src/modules/wounds/*`, `apps/api/src/integrations/storage.ts`, `apps/api/src/lib/{wound-images,media-links,export-files}.ts`; `packages/shared/src/wounds.ts`; mobile `src/features/wounds`, `src/app/patient/wounds`, `src/app/clinician/wound`; admin `src/app/wounds/*`

## Context
People photograph a wound to follow it with their family and their nurse or doctor. The same photos
are valuable for research (healing trajectories, product outcomes, AI evaluation) and for company
education. Wound photos are sensitive health data, can identify a person (face, tattoos, rooms), and
are easy to misuse: shown without permission, kept after withdrawal, used to claim a product
"works", or sent to an AI provider. The project rules require that optional uses are never
preselected, never required, never hidden in general terms; that withdrawal stops future use; that
administrators never browse patient images; that research and presentations need separate approvals;
and that no unvalidated AI classifies wounds or recommends treatment.

## Decision
1. **Three separate permissions per profile** in an append-only ledger (`app.wound_consent_events`,
   UPDATE/DELETE forbidden even to the schema owner):
   - **A · Scan** (required for the feature, for the person's own care only);
   - **B · Research** (optional, OFF) with named purposes (`AI_EVALUATION`, `HEALING_TRAJECTORIES`,
     `PRODUCT_OUTCOMES`, …) and named recipients (`DMW_CLINICAL_RESEARCH`, `ALIA_GROUP`, `TETRASOL`);
   - **C · Presentations** (optional, OFF) with named audiences and organisations.
   A permission is active only when the latest event GRANTs the **current wording version**
   (`2026-10-draft`, status `DRAFT_PENDING_LEGAL_REVIEW`). B and C require A; withdrawing A withdraws
   B and C. Minors: a guardian may allow A only; B and C need the adult or an attested legal
   authority. Refusing B and C never limits A (tested end to end).
2. **The database enforces it.** Adding a case, observation or treatment without active A raises
   `WOUND_SCAN_CONSENT_REQUIRED` in triggers, and a photo in `app.wound_image_register` (its only
   insert path) — not only in the API. Research builds include a
   case only if B covers the dataset's purpose **and** recipient; presentations only if C covers the
   audience and organisation — checked again at preparation, the person's decision, second approval
   and every export. `app.wound_enforce_permissions` runs on every withdrawal: open presentations are
   withdrawn, draft research items deleted, frozen items marked WITHDRAWN with their content and
   copies destroyed.
3. **Photo vault, not database blobs.** Photos are stored as AES-256-GCM objects (AAD = object key)
   behind `ObjectStore`; production storage is `NOT_CONFIGURED` until a provider, region and contract
   are approved (dev/test use `LocalEncryptedStore`). On upload the original's metadata (EXIF/GPS,
   PNG text) is removed losslessly and a ≤ 1024 px derivative is re-encoded. Failed uploads leave
   no object (`PENDING` → `STORED`, swept by `app.wound_maintenance()`), and deletions go through a
   purge queue drained in system context.
4. **Access is re-evaluated on every photo request.** Photos are reachable only through HMAC-signed
   links valid 120 s (`/v1/wound-media?t=`); the server re-checks `app.wound_media_key()` when the link
   is used, so revoking a share, withdrawing a permission or deleting a photo kills links already
   issued. Every view is audited (`wound.image.view`).
5. **Roles and separation of duties**: two new roles in migration 0026, `WOUND_RESEARCHER` (datasets)
   and `PRESENTATION_APPROVER` (library), plus the existing `CLINICAL_REVIEWER` (quality review). The
   application cannot grant a wound role to the signed-in user themself (trigger). Administrators get `wound.registry.read` = **counts only**; no route gives them a photo or
   an identity. Clinicians see wounds only through a care share that explicitly includes wounds
   (`care_shares.wounds_allowed`, off by default); classification and outcome are theirs alone.
6. **Research registry**: frozen, versioned datasets of de-identified snapshots (category, region,
   age band, day numbers — no names, dates, IDs or free text) with keyed pseudonyms; the
   re-identification link and the pseudonym key sit in tables the application role cannot read
   (`wound_research_links`, `wound_research_secrets`). Items need clinical quality review
   by the clinical-reviewer role (researchers cannot review) before freeze; freezing needs an approval reference and a retention date.
   Research copies are re-encoded from the derivative. Export (ZIP with manifest) is a separate
   flag (`wound.research_export`); external AI providers are never a recipient.
7. **Presentation library**: nominate an eligible case (C active, clinician-confirmed type and
   outcome, ≥ 2 photos, never face/neck/intimate sites, adult) → prepare the exact photos and
   bilingual text (identifying text and efficacy claims are refused) → **the person approves that
   exact version** (SHA-256 fingerprint; any change sends it back) → **a different person** completes
   the de-identification checklist → export of that approved version only (PDF or image package with
   use restrictions), while it is valid and still permitted; each export is recorded with its hash.
8. **No AI on wound photos.** `ai.wound_assessment` stays disabled for every account; the case shows
   "analysis off — not validated". Similar cases (`wound.similar_cases`) return no photos or identities
   and are clinician-only. Product-outcome analytics are descriptive, with groups under 5 suppressed
   and a no-causation notice; nothing recommends a product.
9. **Flags and test data.** `wound.registry`, `wound.research`, `wound.research_export`,
   `wound.presentations`, `wound.presentation_export`, `wound.similar_cases` are regulated flags (they
   can be enabled only with an evidence reference). With a flag OFF, internal-test accounts may
   exercise the feature **on test data only**; real staff never see test data and test staff never
   see real data. Production mobile builds do not link `expo-image-picker` and declare no camera,
   photo or microphone strings (release check).

## Consequences
- The registry can be demonstrated and tested end to end (API, mobile web, admin) without any real
  patient photo and without switching a production flag on.
- Every secondary use is provable: who allowed what, which version, when, and which export left.
- Copies already exported before a withdrawal cannot be recalled; the person is told so in the
  presentation wording, and exports stay off until the process is approved.
- Pseudonymisation is not anonymisation: research data stays personal health data under the
  data-sharing agreement.

## Rejected alternatives
- *One broad consent at sign-up* — conflicts with explicit, separate, revocable choices.
- *Images in PostgreSQL rows* — bloats backups, no per-object encryption or lifecycle.
- *Long-lived or public image URLs* — cannot be revoked; replaced by 120 s signed links re-checked on use.
- *Admin photo gallery for moderation* — unnecessary for counts; replaced by duty-specific, audited access.
- *AI wound classification* — not clinically validated; kept disabled server-side.

## Required before any flag is switched on (outside the code)
1. Legal approval of the Arabic and English wording of A, B, C and of the presentation request (then bump `wound.consent_versions`).
2. Storage provider, region and contract; data-protection impact assessment; PDPC licence and cross-border permit if data leaves Egypt.
3. Research/ethics approval reference per dataset; data-sharing agreements before `wound.research_export`.
4. Legal and medical-affairs approval of the presentation process before `wound.presentations` / `wound.presentation_export`.
5. Clinical validation before `wound.similar_cases`; `ai.wound_assessment` needs a separate validation and regulatory review.

## Verification
- `apps/api/test/wounds.test.ts` (26) and `wound-media.test.ts` (11): permissions, vault, family, clinicians, strangers, administrators, research, presentations, withdrawal, deletion, storage lifecycle, role separation, test/real isolation, rate-limited exports.
- `e2e/tests/flow-g-wounds.spec.ts` (patient with A only, clinician through a share, withdrawal) and `flow-e-wounds.spec.ts` (presentation library, second approver, export, research review, administrator limits, withdrawal), including axe checks — Expo **web** and the admin console only; no native device testing.
