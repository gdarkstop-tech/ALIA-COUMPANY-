# Healthcare review readiness: Dress My Wound | غير لي

**Verified on: 2026-10-15**

Scope: the healthcare side of store review for the iOS and Android app (`apps/mobile`), the API (`apps/api`), the admin console (`apps/admin`) and the support site (`apps/site`). The overall release status is in [`RELEASE_STATUS.md`](RELEASE_STATUS.md), which the lead engineer maintains; it is not repeated here. Companion documents: [`APPLE_APP_STORE_CHECKLIST.md`](APPLE_APP_STORE_CHECKLIST.md), [`GOOGLE_PLAY_CHECKLIST.md`](GOOGLE_PLAY_CHECKLIST.md), [`PRIVACY_AND_DATA_DISCLOSURES.md`](PRIVACY_AND_DATA_DISCLOSURES.md) and [`PAYMENT_COMPLIANCE.md`](PAYMENT_COMPLIANCE.md).

- **Requirements** come only from `[verified-official]` findings in [`evidence/STORE_REQUIREMENTS_EVIDENCE.md`](evidence/STORE_REQUIREMENTS_EVIDENCE.md) (verified 2026-10-14). Every other finding is marked **to confirm**. Keys such as [A1], [G1] and [EG3] point to [Official sources](#official-sources).
- **Code read:** commit `89cc0d4`, plus uncommitted working-tree changes that were on disk while this was written (store listing wording, `scripts/release/check.ts`, `scripts/release/brand-rules.ts`, draft legal texts). Lines that depend on those changes say **(working tree)**.
- This is not legal or regulatory advice.

> **Bottom line: the app is NOT ready for submission.**
> - **Approval by the App Store or Google Play is NOT healthcare authorization.** Store review checks Apple's and Google's own policies. It does not license a healthcare service in Egypt, register a medical device, approve health advertising, or verify any clinician ([section 1](#1-store-approval-is-not-healthcare-authorization)).
> - Nothing has run on a phone, emulator or simulator: there is no `/dev/kvm` and no macOS here. No iOS binary exists. VoiceOver, TalkBack, Dynamic Type and native gestures are untested.
> - No Apple, Google or PDPC account exists. These are **placeholders**: legal entity name, support domain and email, Apple Team ID, store product IDs, and all logos and store art (no official Alia Group or TetraSol logo is drawn anywhere).
> - Every legal text, including the medical disclaimer, is a **draft** (`LEGAL_DOCUMENT_STATUS = 'DRAFT_PENDING_LEGAL_REVIEW'`, version `2026-10-draft`).
> - Every regulated clinical and AI feature is **off**. The database will not let any of them be switched on without a regulatory evidence reference, and no register item below has evidence yet.

---

## 0. How to read this document

| Status | Meaning here |
|---|---|
| `CODE_READY` | Implemented in the repo (code, SQL or config). Not confirmed in a native binary unless the line says so. |
| `BUILT` | Confirmed in the locally built Android release APK/AAB of 2026-10-15. That build is signed with the debug key and cannot be distributed. |
| `STORE_METADATA_READY` | The text or asset is in `store/` and passes `scripts/release/check.ts`. |
| `NEEDS_ACCOUNT_ACTION` | Needs App Store Connect, Play Console, a domain, a mailbox or the PDPC portal. |
| `NEEDS_REGULATORY_EVIDENCE` | Needs evidence from an Egyptian authority or regulatory counsel (MoHP, EDA, Medical Syndicate, PDPC, health-advertising committee). |
| `NEEDS_LEGAL_APPROVAL` | Needs counsel sign-off. |
| `NEEDS_OFFICIAL_ASSETS` | Needs final brand files or final native screenshots. |
| `NEEDS_STORE_REVIEW` | Only Apple or Google can decide it. |
| `READY_FOR_SUBMISSION` · `SUBMITTED` · `APPROVED` | **Not assigned to any line.** No line is marked device-tested either, because nothing has run on a device. |
| `—` | No status reached yet: an open engineering gap (see [section 12](#12-open-gaps)). |

**Verification labels:** `verified by automated test (<file>)` · `verified by native build inspection` · `verified by config inspection` (reading code, SQL, config or generated native files) · `not verified`. E2E tests run in Playwright against the Expo **web** build. They stand in for the native app but are not native, so those lines say "(web)".

**Test runs behind the "verified by automated test" lines**

| Suite | Result |
|---|---|
| `apps/api` (Vitest, real PostgreSQL with RLS) | 102 passed in the 2026-10-15 run. A re-run on the current tree while this document was written: **109/109 passed** in 7 files (tests were added after the earlier run). |
| `scripts/release/check.ts` | 46/46 on 2026-10-15. On the current working tree: 58 passed, 0 failed, plus 3 warnings that would fail `--submission` (placeholders in the EN and AR listings and in the legal texts). |
| E2E (Playwright, Expo web build, after `db:reset`) | 13 passed and 4 skipped (on-demand screenshot capture) on 2026-10-15, including `e2e/tests/a11y.spec.ts` (6/6). |

---

## 1. Store approval is not healthcare authorization

Approval from Apple or Google means only that one build met that store's policies when it was reviewed. **It does not authorize Dress My Wound, Alia Group, TetraSol or any clinician to provide healthcare in Egypt.** The store rules themselves point to authorization from outside the stores:

| Store rule (`[verified-official]`) | What it says | Consequence here |
|---|---|---|
| Apple 1.4.1 [A1] | Medical apps get greater scrutiny. If the app has regulatory clearance, a link to it must be submitted. | No clearance is held or claimed. App Review does not create one. |
| Google Health Content and Services [G1] | Apps that are not regulated medical devices must say so in the description. Regulated device apps must declare it and give proof on request. | The app presents itself as **not** a medical device. That holds only while `ai.wound_assessment` and `clinical.diagnostic_suggestions` stay off ([section 7](#7-egyptian-regulatory-position)). |
| Apple 5.1.1(ix) [A1] | Healthcare apps should be submitted by the legal entity that provides the services. | Which entity "provides the services" is a legal question ([section 10](#10-submitter-and-review-access)). |

Authorization has to come from Egyptian bodies. Each one has an entry in the [register](#11-regulatory-evidence-register): MoHP (home-care and visit licensing, emergency number), EDA (software and wound-care products as medical devices), the Medical Syndicate (ethics code, doctor registration), the PDPC (licence for sensitive health data) and the health-advertising committee (Law 206/2017).

---

## 2. Clinical scope of this build

| Capability | In this build? | Where | Flag (default) | Status | Verified by |
|---|---|---|---|---|---|
| Personal and family health record: allergies, conditions, medications, surgeries, blood type, emergency contact. Each entry is badged self-reported or caregiver-reported. | Yes | `apps/mobile/src/app/patient/(tabs)/health.tsx`; migrations `0003`, `0006` | — | CODE_READY | verified by automated test (`apps/api/test/patients.test.ts`: "derives provenance: self entries are patient-reported, others caregiver-reported", "records blood type as reported, never as verified"; `e2e/tests/flow-a-patient.spec.ts` (web)) |
| "Professionally verified" provenance | In the schema, but no code path sets it, and users cannot forge it | `app.health_entries_guard` (0006) | — | CODE_READY | verified by automated test (`apps/api/test/rls.test.ts`: "cannot forge professional verification of a health entry") |
| Discovery of verified doctors and nurses | Yes. Only `APPROVED` profiles are listed. Patients see the credential kind, issuer and date, never licence numbers. | view `app.public_provider_credentials`; `apps/api/src/modules/providers/routes.ts` | — | CODE_READY | verified by automated test (`apps/api/test/rls.test.ts`: "unverified providers are invisible to patients", "credentials (licence numbers) are not readable by patients"; `apps/api/test/providers.test.ts`: "the approved doctor is discoverable with verified credentials but no licence numbers") |
| Booking a home visit or consultation | **No.** "Book now" opens a "Booking opens soon" sheet that says "Nothing has been booked or charged." | `apps/mobile/src/app/patient/provider/[id].tsx` | `care.home_visit_booking` (off). The UI does not read it (H4). | CODE_READY (nothing can be booked) | verified by config inspection |
| Video or remote consultation | **No.** No code exists. | — | `care.video_consultation` (off) | CODE_READY (absent) | verified by config inspection |
| AI health assistant | **No.** The API returns `aiAssistant.status: 'NOT_CONFIGURED'`. Home shows a "Not configured" card (its copy is gap H3). | `apps/api/src/modules/dashboard/routes.ts` | `ai.assistant` (off) | CODE_READY (absent) | verified by config inspection |
| AI wound-photo assessment, camera, photo upload | **No.** No camera or image-picker dependency. `CAMERA`, `RECORD_AUDIO`, location and media permissions are in `android.blockedPermissions`. | `apps/mobile/app.config.ts`, `apps/mobile/package.json` | `ai.wound_assessment` (off) | BUILT (Android) | verified by native build inspection (the built manifest has exactly `INTERNET`, `VIBRATE`, `com.android.vending.BILLING`, `ACCESS_WIFI_STATE`, `ACCESS_NETWORK_STATE` and `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`); verified by config inspection for iOS (the prebuild-generated `Info.plist` has no usage-description keys; no iOS binary exists) |
| Automated diagnosis or triage suggestions | **No.** | — | `clinical.diagnostic_suggestions` (off) | CODE_READY (absent) | verified by config inspection |
| Drug or dressing dosage calculators (Apple 1.4.2, `[verified-official]` [A1]) | **No.** | — | — | CODE_READY (absent) | verified by config inspection |
| Clinician access to patient records | **No path exists.** `app.can_view_patient` needs an active `patient_access` row, and only the patient, guardian or caregiver flows create one. | migrations `0003`, `0006` | — | CODE_READY | verified by automated test (`apps/api/test/rls.test.ts`: "another user cannot see, update or add records to a patient they are not authorized for", "cannot grant itself access to someone else’s patient") |
| TetraSol checkout | Browse and cart only. The checkout preview is simulated and always returns `canPlaceRealOrder: false`. | `apps/api/src/modules/store/routes.ts` | `commerce.checkout` (off; no code reads it) | CODE_READY | verified by automated test (`apps/api/test/store.test.ts`: "checkout preview is explicitly simulated while payments are not configured") |

**No code reads any regulated flag.** A search of `apps/*/src` and `packages/*/src` finds no use of `ai.*`, `clinical.*`, `care.*` or `commerce.checkout` outside the flag list. The only flag the code reads is `billing.store_subscriptions`. The flags are gates set up in advance: switching one on today enables nothing. Each future feature must check its flag **on the server**.

---

## 3. Accurate descriptions (store listing and in-app copy)

Files: `store/metadata/en.json` (locale `en-GB`) and `store/metadata/ar.json` (locale `ar-SA`).

| # | Item | Requirement (source) | State in repo | Status | Verified by |
|---|---|---|---|---|---|
| 3.1 | No diagnostic, healing or efficacy claims in the listing | `[verified-official]` The subtitle may make no unverifiable product claims [A6]. Metadata rules 2.3.x: state which features cost extra, use fictional account data [A1]. | Neither listing makes a diagnostic, healing or efficacy claim or a comparison. TetraSol appears only as "wound-care products". Both say the app "does not diagnose or treat and is not an emergency service" and give 123. | STORE_METADATA_READY · NEEDS_LEGAL_APPROVAL | verified by config inspection |
| 3.2 | The listing does not advertise features that are off | Same sources. That the listing must match the build is the evidence's implication, so treat it as **to confirm**. | **(working tree)** Subtitle is now "Your family's health records" / "السجل الصحي لعائلتك". The keyword "home visit" became "medications". The Play short description no longer says "home-care clinicians". The release check fails the listing if it matches home visit/care, video consultation, AI, wound-analysis or order-now patterns while the matching flag is off (`OFF_BY_DEFAULT_FEATURE_CLAIMS` in `scripts/release/brand-rules.ts`). | STORE_METADATA_READY · NEEDS_LEGAL_APPROVAL | verified by automated test (`scripts/release/check.ts`: "en/ar listing does not advertise care.home_visit_booking (off)" and the four matching checks for the other flags) |
| 3.3 | Play non-device disclaimer | `[verified-official]` The description must say the app is *"not a medical device and does not diagnose, treat, cure, or prevent any medical condition"* [G1]. | **Gap H1.** EN and AR say only "does not diagnose or treat". "Not a medical device", "cure" and "prevent" are missing. | NEEDS_LEGAL_APPROVAL (wording and AR translation) | verified by config inspection |
| 3.4 | Reminder to consult a doctor | `[verified-official]` Apple 1.4.1: should remind users to check with a doctor [A1]. Google: must remind users to consult a healthcare professional [G1]. | **Gap H2.** Missing from both listings and from the in-app `safety.disclaimer`. | NEEDS_LEGAL_APPROVAL | verified by config inspection |
| 3.5 | In-app copy that promises services which are off | **To confirm.** No specific rule is in the evidence; 1.4.1 scrutiny applies to medical apps generally [A1]. | **Gap H14.** `auth.welcomeTitle` "Care that comes home"; `auth.valueHomeBody` "Verified doctors and nurses who come to you."; `roles.DOCTOR_desc` "Offer consultations, lead care teams and follow your patients’ progress."; `roles.NURSE_desc` "Provide home nursing visits, follow care plans…"; `care.bookingSoonBody` "Online booking and payment arrive in the next release." (booking depends on R5 and R6). The listing check does not scan in-app strings. | NEEDS_LEGAL_APPROVAL | verified by config inspection |
| 3.6 | Home AI card, "Assistant name" row, System status screen | **To confirm.** | **Gap H3:** `home.aiNotConfigured` says "It will explain lab reports and medical terms in plain language", which describes interpreting clinical results; that is not built and is gated by `ai.assistant`. **Gap H13:** Me shows an "Assistant name" row, and Me > System status lists AI and other integrations as not configured. | — | verified by config inspection |
| 3.7 | Home TetraSol card | **To confirm** (accuracy; Law 206/2017 [EG10]). | **Gap H5.** `home.tetrasolBody` says "Approved TetraSol wound-care products, delivered." There is no delivery or checkout, and "Approved" can be read as regulatory approval when it means only brand-owner content approval. | NEEDS_LEGAL_APPROVAL | verified by config inspection |
| 3.8 | Clinician claims | Must match the code. | "Credentials have been reviewed by our team" matches the manual admin review ([section 5](#5-clinician-credential-verification)). No Syndicate integration and no outcome guarantee is claimed. The Terms say verification "is not a guarantee of clinical outcomes". | STORE_METADATA_READY · NEEDS_LEGAL_APPROVAL | verified by config inspection |
| 3.9 | Screenshots | `[verified-official]` Most screenshots must show the app in use [A7]. Use fictional account data, suitable for a 4+ audience (2.3.x) [A1]. | No final screenshots. Drafts from the web harness (`e2e/tests/store-screenshots.spec.ts`, `STORE_SHOTS=1`, written to the untracked `store/screenshots/draft-web-harness/`) use synthetic data and must be replaced by native captures. All visual assets are temporary placeholders. | NEEDS_OFFICIAL_ASSETS | not verified |
| 3.10 | Age rating | `[verified-official]` Frequent medical or treatment information gives 16+. Answers must be honest [A4]. | Not answered yet. | NEEDS_ACCOUNT_ACTION | not verified |
| 3.11 | Category | `[verified-official]` Category definitions [A5]. | Medical is recommended on both stores (see the Apple and Google checklists). | NEEDS_ACCOUNT_ACTION | not verified |
| 3.12 | Strength of the disclaimer check | — | **Gap H11.** "metadata states the emergency/no-diagnosis limits" only tests that `123` or `١٢٣` appears. It does not test the disclaimer wording. | — | verified by config inspection |

---

## 4. Disclaimers and emergency signposting

| # | Item | Requirement (source) | State in repo | Status | Verified by |
|---|---|---|---|---|---|
| 4.1 | `MedicalDisclaimer` on the Health tab | `[verified-official]` Remind users to consult a professional [A1][G1]. | `apps/mobile/src/features/compliance/Safety.tsx` renders `safety.disclaimer` at the bottom of `patient/(tabs)/health.tsx`. EN: "Dress My Wound helps you organise information and reach verified clinicians. It does not diagnose or treat." AR: "يساعدك غير لي على تنظيم معلوماتك والوصول إلى مقدمي رعاية موثَّقين، ولا يقدم تشخيصًا أو علاجًا." The wording does not tell users to consult a doctor (gap H2). | CODE_READY (component) · NEEDS_LEGAL_APPROVAL (wording) | verified by config inspection. `e2e/tests/a11y.spec.ts` (web) renders the Health tab but does not assert the `medical-disclaimer` testID (gap H12). |
| 4.2 | `EmergencyNotice` with `tel:123` on the Health tab | **To confirm:** 123 is `official-but-ambiguous` (a UK FCDO page) [EG2]. | A red "Not for emergencies" notice with a button that calls `Linking.openURL('tel:123')`, minimum target 44 × 44. The number comes from `EMERGENCY_NUMBERS = { ambulance: '123' }` in `packages/shared/src/compliance.ts`. | CODE_READY · NEEDS_REGULATORY_EVIDENCE (R1) | verified by config inspection. The `emergency-notice` and `call-emergency` testIDs are not asserted (H12). The `tel:` hand-off has not run on any device. |
| 4.3 | Fire and police numbers | Sources conflict: fire is 180 on the UK FCDO page and 125 on an AUC page; whether 112 works nationwide is unconfirmed [EG2]. | **Deliberately not shown.** Only the ambulance number 123 appears anywhere. | CODE_READY · NEEDS_REGULATORY_EVIDENCE (R1) | verified by config inspection |
| 4.4 | Where the notice appears | **To confirm:** the evidence implication (official-but-ambiguous) suggests patient screens, the AI assistant, booking and symptom entry, with a server-configurable number [EG2]. | **Gap H7.** Health tab only: not on Care, the booking sheet, `AddEntrySheet`, home or the onboarding health step. The number is compiled into the app, so changing it needs a new release. | — | verified by config inspection |
| 4.5 | Medical disclaimer document | `[verified-official]` reminders [A1][G1]. | `LEGAL_DOCUMENTS['medical-disclaimer']` in `packages/shared/src/legal.ts`, EN and AR: entries are self-reported and not a diagnosis; no automated diagnosis or treatment advice, which "will only be offered after the required clinical validation and regulatory approval"; in an emergency call 123 or go to the nearest emergency department. Linked from Privacy & consent (`apps/mobile/src/app/settings/privacy.tsx`). Published at `/medical-disclaimer` by `apps/site/build.ts`. The app and the site both show a "draft" notice. | CODE_READY · NEEDS_LEGAL_APPROVAL · NEEDS_ACCOUNT_ACTION (support domain is a placeholder) | verified by config inspection |
| 4.6 | Terms: "Not an emergency or diagnostic service" | Same sources. | "In an emergency in Egypt call 123 (ambulance). Always follow the advice of a qualified clinician." | CODE_READY · NEEDS_LEGAL_APPROVAL | verified by config inspection |
| 4.7 | Support site footer | — | Every page says the app "is not an emergency service — in Egypt call 123 for an ambulance." | CODE_READY · NEEDS_ACCOUNT_ACTION (hosting and domain) | verified by config inspection |
| 4.8 | Listing limits | 3.3 and 3.4 above. | "Does not diagnose or treat and is not an emergency service. In an emergency in Egypt call 123." in both languages, but without the Play wording (H1) or the doctor reminder (H2). | STORE_METADATA_READY (partial) · NEEDS_LEGAL_APPROVAL | verified by automated test (`scripts/release/check.ts`: "en/ar metadata states the emergency/no-diagnosis limits") |
| 4.9 | Explicit health-data consent before any health data is stored | `[verified-official]` PDPL: health data is sensitive personal data [EG1]. Explicit written consent (PDPL Art. 12) is **to confirm** (secondary source) [EG11]. | Enforced by the database. `create_patient_profile`, `health_entries_guard`, `patients_guard` (profile edits) and `health_entries_update_guard` (entry content edits) raise `HEALTH_DATA_CONSENT_REQUIRED`. The consent ledger is append-only. Onboarding asks for consent in context and never pre-ticks it. Withdrawing consent pauses new entries; marking an entry entered-in-error still works. | CODE_READY · NEEDS_LEGAL_APPROVAL (consent text) | verified by automated test (`apps/api/test/compliance.test.ts`: "blocks health data until explicit health-data consent is given (database-enforced)", "withdrawing health-data consent stops new health entries; history stays append-only"; `e2e/tests/flow-a-patient.spec.ts`, `e2e/tests/flow-f-privacy.spec.ts` (web)) |

**Before every release:** re-confirm 123 with the Ministry of Health and Population (MoHP) under register item R1. Add no other number until an Egyptian official source confirms it.

---

## 5. Clinician credential verification

### 5.1 Workflow as coded (migration `0004_providers_verification.sql`, `apps/api/src/modules/providers/routes.ts`, `apps/admin/src/app/verification/*`)

| # | Control | State in repo | Status | Verified by |
|---|---|---|---|---|
| 5.1.1 | Required credentials | Doctors: `NATIONAL_ID`, `MEDICAL_LICENSE`, `MEDICAL_DEGREE`. Nurses: `NATIONAL_ID`, `NURSING_LICENSE` (`app.required_credential_kinds`, mirrored in `packages/shared`). Whether this is the right set is R9 and R10. | CODE_READY · NEEDS_REGULATORY_EVIDENCE | verified by automated test (`apps/api/test/rls.test.ts`: "SQL required-credential lists match the shared TypeScript constants") |
| 5.1.2 | State machine | `DRAFT → SUBMITTED` needs every required credential present and not rejected. `→ APPROVED` needs every required credential `APPROVED`. `REJECTED`, `CHANGES_REQUESTED` and `SUSPENDED` need a written reason. Only an ADMIN moves between `APPROVED` and `SUSPENDED`. | CODE_READY | verified by automated test (`apps/api/test/providers.test.ts`: "cannot submit before required credentials are added", "requires a reason to reject or request changes", "cannot approve the provider until every required credential is approved", "a reviewer cannot suspend (admin-only transition)") |
| 5.1.3 | Separation of duties | A provider cannot approve themselves. Staff can decide on credentials but cannot edit their data. Support staff can review but not decide. Reviewer ID and time are stamped on every decision. | CODE_READY | verified by automated test (`apps/api/test/rls.test.ts`: "a provider cannot approve or verify themselves", "support staff can review but not decide") |
| 5.1.4 | Re-review on material change | Changing the specialty or display name after approval sends the profile back to `SUBMITTED`. Editing a non-approved credential resets it to `PENDING`; approved credentials are locked. | CODE_READY | verified by automated test (`apps/api/test/providers.test.ts`: "changing specialty after approval sends the profile back for review") |
| 5.1.5 | Patient visibility | Unverified providers are invisible to patients. Patients see "verified" with issuer and date, never licence numbers. | CODE_READY | verified by automated test (`apps/api/test/rls.test.ts`, see 5.1.3; `apps/api/test/providers.test.ts`: "is not discoverable while under review") |
| 5.1.6 | Audit | A trigger writes the history. Audit events include `provider.verification.*`, `provider.credential.*` and the reviewer's view of a submission. | CODE_READY | verified by automated test (`apps/api/test/providers.test.ts`: "records verification history and audit events", "the reviewer sees the submission with credential details (and the view is audited)") |
| 5.1.7 | Admin console review | The verification queue and detail pages show kind, issuer, identifier and expiry, with approve and reject actions per credential. | CODE_READY | verified by automated test (`e2e/tests/flow-e-admin.spec.ts` (web): "Flow E — admin reviews credentials and decides") |
| 5.1.8 | Identity documents on account deletion | Credentials (national ID, licence numbers) are deleted even when payout records must be kept. The profile is then suspended, renamed "Deleted account" and scrubbed. | CODE_READY · NEEDS_LEGAL_APPROVAL (retention periods, R15) | verified by automated test (`apps/api/test/compliance.test.ts`: "providers with financial ledger entries are suspended and scrubbed, records retained") |

### 5.2 Limits and open questions

| # | Item | Evidence | State | Status | Verified by |
|---|---|---|---|---|---|
| 5.2.1 | Medical Syndicate lookup | `[verified-official]` ems.org.eg offers an online doctor inquiry; no public API was found [EG4]. | No integration; use the lookup as a **manual** check. **Gap H8:** nothing records that the lookup was done, by whom, or what it showed. Do not claim automated Syndicate verification. | NEEDS_REGULATORY_EVIDENCE (R9) | verified by config inspection |
| 5.2.2 | MoHP practice licence and Syndicate registration | **To confirm** (secondary source): Law 415/1954 requires both; Law 153/2019 reportedly makes registration valid for 5 years [EG6]. | One `MEDICAL_LICENSE` kind; no separate Syndicate-registration kind. | NEEDS_REGULATORY_EVIDENCE (R9) · NEEDS_LEGAL_APPROVAL | verified by config inspection |
| 5.2.3 | Licence expiry | Implication of [EG6] (**to confirm**): block bookings when a licence has expired. | **Gap H8.** `expires_on` is stored and shown to the reviewer but **not enforced**: nothing suspends or hides a provider whose licence expires. Required before `care.home_visit_booking` can be enabled. | — | verified by config inspection |
| 5.2.4 | Credential documents | — | **Gap H8.** No upload exists; `document_object_key` is reserved ("secure storage arrives with M2/M3"). Reviewers see typed data only and must check original documents outside the system. | — | verified by config inspection |
| 5.2.5 | Nurse registration lookup | Unresolved in the evidence: no Nursing Syndicate site or lookup was found. | Manual review only. | NEEDS_REGULATORY_EVIDENCE (R10) | not verified |
| 5.2.6 | Synthetic credentials in seed data | — | `apps/api/src/db/seed.ts` issues credentials from "Synthetic Demo Authority" with `DEMO-*` identifiers, and every seeded clinician bio says it is synthetic ("Synthetic demo profile…" or "Synthetic demo submission…"). It refuses to run in production or with `DEMO_MODE` off. | CODE_READY | verified by config inspection |
| 5.2.7 | Review clinicians | — | `apps/api/src/db/seed-review.ts` creates Patient, Doctor and Nurse review accounts (`account_kind = 'REVIEW'`). The doctor and nurse get `APPROVED`, `is_demo = true` profiles with the bio "Synthetic review profile — not a real clinician." and **no credential rows**, inserted by the database owner. The script needs a password of 16 or more characters that is not a guessable word, a `REVIEW_EMAIL_DOMAIN`, and `--confirm-production` in production. It refuses to adopt an address held by a non-review account, and each run rotates the password and signs out old sessions. Tell App Review in the notes that these clinicians are synthetic. | CODE_READY · NEEDS_ACCOUNT_ACTION (run against production with a real domain and password) | verified by automated test (`apps/api/test/compliance.test.ts`: "review accounts see only synthetic catalogue rows; real accounts never see them", "users cannot promote themselves to a review account"); verified by config inspection (seed script) |

---

## 6. Server-side feature flags (migration `0006_compliance_foundation.sql`)

| Key | Risk | Needs regulatory evidence | Default | Description in the migration | Register |
|---|---|---|---|---|---|
| `ai.assistant` | HIGH | yes | **off** | Conversational health assistant; needs clinical-safety review, AI governance sign-off and regulatory assessment | R2, R3, R13 |
| `ai.wound_assessment` | HIGH | yes | **off** | AI analysis of wound photos; potential software as a medical device; needs regulatory clearance evidence | R2 |
| `clinical.diagnostic_suggestions` | HIGH | yes | **off** | Any automated diagnostic or triage suggestion; needs a validation study and regulatory evidence | R2, R4 |
| `care.home_visit_booking` | MEDIUM | yes | **off** | Needs confirmation of MoHP licensing for the operating entity | R5, R6, R8, R9, R10 |
| `care.video_consultation` | MEDIUM | yes | **off** | Needs telemedicine licensing evidence | R6, R7 |
| `commerce.checkout` | MEDIUM | no | **off** | Paid TetraSol checkout through the external gateway | R11, R12 (process control only; see 6.2) |
| `billing.store_subscriptions` | MEDIUM | no | **off** | Apple IAP or Google Play Billing (see `PAYMENT_COMPLIANCE.md`) | — |

### 6.1 Controls

| # | Control | State in repo | Status | Verified by |
|---|---|---|---|---|
| 6.1.1 | Database guard | `CONSTRAINT regulated_feature_needs_evidence CHECK (NOT enabled OR NOT requires_regulatory_evidence OR evidence_ref IS NOT NULL)`. This holds even if the API is bypassed. | CODE_READY | verified by automated test (`apps/api/test/compliance.test.ts`: "only admins manage flags, and HIGH-risk features need a regulatory evidence reference", including a direct SQL update rejected with `regulated_feature_needs_evidence`) |
| 6.1.2 | API guard | `PATCH /v1/admin/features/:key` requires the ADMIN role and `enforceMfa`, and returns 422 `REGULATORY_EVIDENCE_REQUIRED` without a reference. A patient gets 403. | CODE_READY | verified by automated test (same test) |
| 6.1.3 | Protected fields and audit | The app role cannot change `risk`, `requires_regulatory_evidence` or `key` (`PROTECTED_FIELD`). Every change is audited as `feature.flag.updated` with `from`, `to` and `evidenceRef`, and `updated_by_user_id` records the acting admin. | CODE_READY | verified by automated test (same test: audit rows counted, acting admin recorded) |
| 6.1.4 | Off by default, fail-closed clients | `GET /v1/system/features` returns every flag `false`. Clients use `FEATURES_OFF` until the server answers (`useFeatures` in `apps/mobile/src/features/compliance/hooks.ts`). Review accounts see `billing.store_subscriptions` as available so App Review can buy; this does not touch the regulated flags. | CODE_READY | verified by automated test (`apps/api/test/compliance.test.ts`: "exposes every regulated feature as OFF by default") |
| 6.1.5 | Admin Feature flags page | `apps/admin/src/app/features/page.tsx`: key, description, last update, risk badge, "evidence required" label, evidence-reference input, enable or disable button, and the server's error shown on refusal. | CODE_READY | verified by config inspection (no E2E test of this page) |
| 6.1.6 | Production configuration guard | The API refuses to boot in production with `DEMO_MODE`, dev tools, `MFA_ENFORCEMENT` other than `required`, or an owner database URL. | CODE_READY | verified by automated test (`apps/api/test/auth.test.ts`: "refuses to boot production with demo mode, dev tools, or MFA in warn mode"); owner-URL rule verified by config inspection (`apps/api/src/config/env.ts`) |

### 6.2 Limits of the flags (state these precisely in review notes)

- The flags gate features that **do not exist yet** (section 2). Any future feature must check its flag **on the server**; a UI check is not enough. The "Book now" sheet already ignores `care.home_visit_booking` (H4).
- `evidence_ref` is free text of 3 to 300 characters. The database proves that **a reference was recorded**, not that the evidence is valid. **Gap H9:** nothing ties the reference to the [register](#11-regulatory-evidence-register). Proposed process control: `evidence_ref` must cite a register ID (for example `HCR-R2: <document reference>`), and the register owner signs off before an ADMIN enables the flag.
- `commerce.checkout` does not require evidence in the database, but EDA product registration (R11) and health-advertising approval (R12) still apply. Nothing gates checkout on them (H10).

---

## 7. Egyptian regulatory position

| # | Topic | Finding (confidence) | What the code does | Status |
|---|---|---|---|---|
| 7.1 | AI wound assessment is software as a medical device (SaMD) | `[verified-official]` EDA's definition of "medical device" covers **application software** meant for diagnosis, monitoring, treatment or alleviation of disease or injury (EDREX:GL.CAMD.003 v03, effective 2025-09-01) [EG8]. No dedicated EDA guideline on SaMD was found. | AI wound assessment would fall within this definition, so `ai.wound_assessment` is off and needs evidence. The assistant and diagnostic suggestions are off too. No diagnostic claim is made. | NEEDS_REGULATORY_EVIDENCE (R2) |
| 7.2 | No remote diagnosis without an examination | `[verified-official]` Medical Syndicate ethics code, Decree 238/2003, **Art. 15**: a doctor may not firmly diagnose or recommend treatment from oral, written or visual data without examining the patient in person [EG3]. | No remote diagnosis, chat, photo review or video exists. `care.video_consultation` and `clinical.diagnostic_suggestions` are off. Any future remote feature must stay with triage, education and booking, with diagnosis and treatment at the in-person visit. | CODE_READY (absence) · NEEDS_LEGAL_APPROVAL (any future remote design) |
| 7.3 | 2024 proposal to amend Art. 15 for telemedicine | **To confirm** (`could-not-verify`): nothing shows it was adopted [EG5]. | Nothing is built or marketed on the assumption that it was. | NEEDS_REGULATORY_EVIDENCE (R7) |
| 7.4 | Intermediaries, commissions, use of a doctor's name | **To confirm** (`official-but-ambiguous`; the article number is not legible): the code bars doctors from using paid or unpaid intermediaries, lending their name to commercial promotion, and taking rewards for prescribing or referring [EG3]. Whether a matching platform that charges fees is an "intermediary" **needs counsel**. | No clinician commission, referral or product-recommendation code exists, and the store shows no clinicians. Open for counsel: the ledger type `PLATFORM_FEE` (migration `0005`) and the Gold and Platinum `REAL_WORLD` benefits "Priority matching", "Reduced eligible platform fees" and "Enhanced booking benefits" (migration `0007`; gap H15). | NEEDS_LEGAL_APPROVAL · NEEDS_REGULATORY_EVIDENCE (R8) |
| 7.5 | Medical liability and informed consent (future booking) | **To confirm** (`secondary-source-only`): Law 13/2025 counts consultations and nursing care as "medical services", requires **written informed consent on the MoHP form**, and requires providers to join the medical-error insurance fund [EG7]. | Not applicable while booking is off; no informed-consent capture exists. Before `care.home_visit_booking` is enabled: provider terms covering consent, records and the insurance fund, and possibly support for capturing the MoHP form. The app must not replace the provider's own consent obligation. | NEEDS_REGULATORY_EVIDENCE (R6) · NEEDS_LEGAL_APPROVAL |
| 7.6 | Health advertising (TetraSol promotions) | **To confirm** (critique item, law-firm summary only): Law 206/2017 requires prior approval from a dedicated committee to advertise health products or services; penalties include imprisonment and fines of EGP 50,000 to 100,000 [EG10]. | Real users see a TetraSol product only when it is `APPROVED` with an `approval_reference`, but that records **brand-owner** approval, not the committee's. Marketing consent is optional and unticked by default. No code sends marketing messages, and the app has no push or ad SDK. Listing text, the home TetraSol card (H5) and any future promotion need a counsel decision. | NEEDS_REGULATORY_EVIDENCE (R12) · NEEDS_LEGAL_APPROVAL |
| 7.7 | Telemedicine law | **To confirm** (`secondary-source-only`): no dedicated Egyptian telemedicine or digital-health law, and no MoHP licensing decree, was found [EG9]. | `care.video_consultation` is off and needs evidence. | NEEDS_REGULATORY_EVIDENCE (R7) |
| 7.8 | MoHP licensing of home care or a booking platform | **To confirm** (`secondary-source-only`, unresolved): Law 51/1981 licenses "places"; no decree covering home-care companies was found [EG9]. | `care.home_visit_booking` is off and cannot be enabled without an `evidence_ref`. The legal texts do not present the app as a healthcare provider. | NEEDS_REGULATORY_EVIDENCE (R5) |
| 7.9 | TetraSol products as medical devices | Implication of the `[verified-official]` EDA definition [EG8], **to confirm** per product: dressings are likely medical devices that need EDA registration or import approval. TetraSol's registration status is unconfirmed. | Seeded items are placeholders (`demo-*`, `PENDING_APPROVAL`, "No therapeutic claims"). **Gap H10:** no field for an EDA registration number; `regulatory_note` is free text. | NEEDS_REGULATORY_EVIDENCE (R11) |
| 7.10 | Health data under the PDPL | `[verified-official]` Health data is sensitive personal data; data users need a PDPC licence or permit; cross-border transfer needs a PDPC licence [EG1]. | Health-data consent is enforced in the database (4.9). The full PDPL position is in `PRIVACY_AND_DATA_DISCLOSURES.md`, section 11. | CODE_READY (consent) · NEEDS_REGULATORY_EVIDENCE (R13) |

---

## 8. Separation of commercial and clinical content

| # | Control | State in repo | Status | Verified by |
|---|---|---|---|---|
| 8.1 | One brand only, enforced by the database | `products.brand CHECK (brand = 'TetraSol')`. The store has its own tab with the notice "TetraSol Care sells TetraSol products only." The Health tab has no store content. | CODE_READY | verified by automated test (`apps/api/test/rls.test.ts`: "rejects any non-TetraSol product, even from a commerce manager") |
| 8.2 | Products shown only after approval | `CHECK approved_requires_reference`: `APPROVED` needs `approval_reference` and `approved_at`. New products default to `PENDING_APPROVAL`. Real users see only `APPROVED`, non-demo items. The product page shows the approval reference and any regulatory note. | CODE_READY · NEEDS_OFFICIAL_ASSETS (real catalogue from the brand owner) | verified by automated test (`apps/api/test/rls.test.ts`: "cannot mark a product APPROVED without a brand approval reference") |
| 8.3 | Synthetic placeholders cannot pass as real | `CHECK demo_items_identifiable`: demo items need a `demo-*` slug and can never be `APPROVED`. The UI says "Synthetic placeholder for interface development. Not a real product, price or stock level. No therapeutic claims." Demo items are hidden when demo mode is off, except from review accounts. | CODE_READY | verified by automated test (`apps/api/test/rls.test.ts`: "a demo product can never be flagged as brand-approved", "demo products are never visible outside demo mode"; `apps/api/test/store.test.ts`: "hides demo catalog items entirely when demo mode is off"; `e2e/tests/flow-d-tetrasol.spec.ts` (web)) |
| 8.4 | Review accounts | Reviewers see only synthetic patients and clinicians. For the catalogue (no personal data) they see the same approved TetraSol products and nursing-service types as real users, so they review what users get, plus the labelled `demo-*` placeholders. Real users never see review data. | CODE_READY | verified by automated test (`apps/api/test/compliance.test.ts`: "review accounts see only synthetic catalogue rows; real accounts never see them", which also asserts that the reviewer sees an approved real product) |
| 8.5 | No clinical endorsement of products | No code links a clinician to a product: no recommendation, commission or referral. Clinician profiles carry no product content. | CODE_READY (absence) | verified by config inspection |
| 8.6 | Health data not used for marketing | `[verified-official]` Apple 5.1.3: health data may not be used for advertising or marketing except with permission to improve health management or for research [A1]. No analytics or ad SDK is in `apps/mobile/package.json`. Marketing consent is separate and optional. No code selects products from health records. | CODE_READY · NEEDS_LEGAL_APPROVAL (privacy policy) | verified by config inspection |
| 8.7 | Payment rails for physical and clinical items | `[verified-official]` Apple 3.1.3(e) and 3.1.3(d) [A1]; Google: regulated clinical services should not use Play Billing [G4]. `resolvePaymentRail` sends physical goods, physical services and eligible 1:1 consultations to the external gateway on every platform. **(working tree)** The draft Terms say "Plans unlock app features only; clinical services and TetraSol products are paid separately when they become available." | CODE_READY | verified by automated test (`apps/api/test/billing.test.ts`: "routes physical goods, physical services and 1:1 consultations to the external gateway on every platform") |
| 8.8 | Placement next to health content | Home shows a TetraSol card below the health sections; its copy is gap H5. | NEEDS_LEGAL_APPROVAL | verified by config inspection |

---

## 9. Secure records

| # | Item | State in repo | Status | Verified by |
|---|---|---|---|---|
| 9.1 | Row-level security | The app role is not a superuser, has no BYPASSRLS and owns no tables. It cannot read Better Auth secrets. Unauthorized patients return 404, not 403. Medical records cannot be hard-deleted (entered-in-error instead). | CODE_READY | verified by automated test (`apps/api/test/rls.test.ts`: "the application role is not superuser, has no BYPASSRLS and owns no tables", "the API returns 404 (not 403) for patients the caller cannot see", "cannot hard-delete medical records") |
| 9.2 | Audit log | Append-only (`forbid_mutation`); readable only with `audit.read`. Covers patient profiles, health entries, verification, feature flags and account deletion. | CODE_READY | verified by automated test (`apps/api/test/rls.test.ts`: "audit log is append-only and readable only with audit.read") |
| 9.3 | MFA for staff and clinicians | `MFA_REQUIRED_ROLES` = clinician roles plus staff roles (`packages/shared/src/roles.ts`). Enforced when `MFA_ENFORCEMENT=required`, which production requires (6.1.6). Accounts with two-step verification cannot sign in with an SMS code alone. | CODE_READY | verified by automated test (`apps/api/test/auth.test.ts`: "blocks staff endpoints without two-factor when enforcement is required", "a session cannot re-bind the sign-in phone, and 2FA accounts cannot sign in with a phone code alone") |
| 9.4 | No Android device backup of medical data | `android:allowBackup=false` in the built manifest. | BUILT | verified by native build inspection |
| 9.5 | No PHI in iCloud | `[verified-official]` Apple 5.1.3: personal health information may not be stored in iCloud [A1]. The generated iOS entitlements file is empty (no iCloud or CloudKit). | CODE_READY | verified by config inspection (prebuild output; no iOS binary) |
| 9.6 | iOS privacy manifest declares health data | `NSPrivacyCollectedDataTypeHealth`, linked, not tracking, app functionality, in `app.config.ts`; present in the generated `PrivacyInfo.xcprivacy`. | CODE_READY | verified by automated test (`scripts/release/check.ts`: "privacy manifest declares health data") |
| 9.7 | Crash reports carry no health data | `POST /v1/telemetry/client-errors` is not linked to the user and redacts emails, numbers (including Arabic-Indic digits), JWT-like tokens and credential values. | CODE_READY | verified by config inspection |
| 9.8 | In-app account deletion | `app.delete_my_account` deletes the caller's own health records, credentials and sessions; shared profiles stay with their other managers; provider payout records are kept (`COMPLETED_WITH_RETENTION`). Retention periods are placeholders (R15). Details: `PRIVACY_AND_DATA_DISCLOSURES.md`, section 7. | CODE_READY · NEEDS_LEGAL_APPROVAL | verified by automated test (`apps/api/test/compliance.test.ts`, "account deletion" suite; `e2e/tests/flow-f-privacy.spec.ts` (web)) |

---

## 10. Submitter and review access

| # | Item | Requirement (source) | State | Status | Verified by |
|---|---|---|---|---|---|
| 10.1 | Submitted by the legal entity that provides the services | `[verified-official]` Apple 5.1.1(ix) [A1]. Organization enrollment needs a legal entity, a D-U-N-S number, binding authority and a website [A2]. Google: health apps need an Organization account with a D-U-N-S number [G3]. | The legal entity is a placeholder (`<ALIA_GROUP_LEGAL_ENTITY_TO_CONFIRM>`; `[Legal entity name of Alia Group — to be confirmed]` in the legal texts). Counsel must decide **which entity provides the services**. The app does not present itself as a healthcare provider, and clinicians are individually licensed. | NEEDS_LEGAL_APPROVAL · NEEDS_ACCOUNT_ACTION | not verified |
| 10.2 | Review accounts with a working backend | `[verified-official]` A demo account that does not expire, with the backend live [A8]. Play App access instructions for gated areas [G7]. | See 5.2.7. | CODE_READY · NEEDS_ACCOUNT_ACTION | verified by automated test (`apps/api/test/compliance.test.ts`: "review account isolation" suite) |
| 10.3 | App Review notes on health scope | `[verified-official]` 1.4.1 [A1]. | Draft in `APPLE_APP_STORE_CHECKLIST.md`, section 13.1. It must say: no diagnosis; AI is off; review clinicians are synthetic; checkout is simulated; no regulatory clearance is held or claimed. | NEEDS_LEGAL_APPROVAL · NEEDS_ACCOUNT_ACTION (placeholders) | not verified |
| 10.4 | Play Health apps declaration | `[verified-official]` Every app on a closed, open or production track completes it. Do not select Medical Device unless the app is a regulated device [G2]. | Proposed selections in `GOOGLE_PLAY_CHECKLIST.md`, section 5.7a. | NEEDS_ACCOUNT_ACTION · NEEDS_LEGAL_APPROVAL | not verified |
| 10.5 | Apple regulated-medical-device declaration | `[verified-official]` Applies to apps offered in the EU/EEA, UK or US in the Medical or Health & Fitness category, or answering "frequent" medical information [A3]. | Keep availability to Egypt only for v1. | NEEDS_ACCOUNT_ACTION | not verified |
| 10.6 | If AI is ever enabled | `[verified-official]` Apple 5.1.2(i): explicit permission before sharing data with third-party AI [A1]. `[verified-official]` Google: camera, location and microphone are health-sensitive permissions needing prominent disclosure and consent [G6]. **To confirm:** Google's AI-generated content reporting rule (critique item) [G5]. | Not applicable while every `ai.*` flag is off and no camera exists. | NEEDS_REGULATORY_EVIDENCE (R2, R3) | verified by config inspection |
| 10.7 | The store decision | Only Apple and Google decide. **Approval would not be healthcare authorization** (section 1). | — | NEEDS_STORE_REVIEW | not verified |

---

## 11. Regulatory evidence register

Every item has status **`NEEDS_REGULATORY_EVIDENCE`** and owner **TBD**. No item has evidence yet. A flag's `evidence_ref` should cite the ID used here (6.2).

| ID | Evidence needed | Required for | Confidence today | Status | Owner | Evidence ref |
|---|---|---|---|---|---|---|
| R1 | Written MoHP confirmation of the ambulance number 123, and whether 112 works nationwide | `EmergencyNotice`, medical disclaimer, Terms, site footer, store descriptions | official-but-ambiguous (UK FCDO) [EG2] | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R2 | EDA classification of AI wound assessment, the assistant and diagnostic suggestions as SaMD or not, and registration if they are | `ai.wound_assessment`, `ai.assistant`, `clinical.diagnostic_suggestions`; Apple 1.4.1 clearance link; Play "Medical Device Apps" choice | verified-official definition [EG8]; no SaMD guideline found | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R3 | Clinical-safety and AI-governance assessment of the assistant: provider, data flows, report and flag controls | `ai.assistant` | Apple 5.1.2(i) verified-official [A1]; Google AI rule to confirm [G5] | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R4 | Clinical validation study for any triage or diagnostic output, with its methodology disclosed | `clinical.diagnostic_suggestions` | Apple 1.4.1 [A1] and Decree 238/2003 Art. 15 [EG3] verified-official | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R5 | MoHP position on licensing the home-care or home-visit operation and the booking platform | `care.home_visit_booking`; home-care wording in the app (H14) | secondary-source-only [EG9] | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R6 | Law 13/2025: the MoHP informed-consent form, insurance-fund rules and effective dates | `care.home_visit_booking`, `care.video_consultation`, provider terms | secondary-source-only [EG7] | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R7 | Telemedicine position: no law found; status of the Art. 15 amendment | `care.video_consultation` | secondary-source-only / could-not-verify [EG9][EG5] | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R8 | Counsel opinion under the ethics code on intermediaries and commissions: platform fees, priority matching, reduced fees, booking benefits | Booking; `PLATFORM_FEE` ledger; Gold and Platinum `REAL_WORLD` benefits (H15) | official-but-ambiguous [EG3] | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R9 | Doctor credential standard: MoHP practice licence, Syndicate registration, validity period, and the EMS manual-lookup procedure | Provider approval; `care.home_visit_booking` | EMS lookup verified-official [EG4]; Law 415/1954 secondary [EG6] | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R10 | Nurse credential standard: Nursing Syndicate registration or licensing, and how to verify it | Nurse approval; `care.home_visit_booking` | unresolved (not found) | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R11 | EDA registration or import approval for each TetraSol product, with its number | Setting a real product `APPROVED`; `commerce.checkout` | implication of the verified-official EDA definition [EG8]; status unconfirmed | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R12 | Law 206/2017 committee approval for health advertising, or counsel's view that it does not apply | TetraSol promotions, listing text, home TetraSol card, any marketing message | critique item, law-firm summary [EG10] | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R13 | PDPC licence covering sensitive health data, plus a cross-border permit if hosting or an AI provider is outside Egypt | Launch with any health data; `ai.assistant` | verified-official [EG1] | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R14 | Limits on selling medicines or pharmacy products online, if any listed product is a medicine | Store catalogue | not verified (critique "missing" item) | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R15 | Statutory retention periods for medical and financial records | Account deletion summary, privacy policy | not verified (critique "missing" item) | NEEDS_REGULATORY_EVIDENCE | TBD | — |

---

## 12. Open gaps

| ID | Gap | File | Status | Fix owner |
|---|---|---|---|---|
| H1 | The Play non-device disclaimer ("not a medical device … cure, or prevent") is missing in EN and AR. | `store/metadata/en.json`, `ar.json` | NEEDS_LEGAL_APPROVAL | Engineering + counsel |
| H2 | No explicit "consult a doctor or healthcare professional" reminder in the listings or in the Health-tab disclaimer. | `store/metadata/*.json`; `packages/i18n/src/{en,ar}.ts` (`safety.disclaimer`) | NEEDS_LEGAL_APPROVAL | Engineering + counsel |
| H3 | The home AI card promises to "explain lab reports and medical terms" while `ai.assistant` is off. | `packages/i18n/src/{en,ar}.ts` (`home.aiNotConfigured`); `apps/mobile/src/app/patient/(tabs)/index.tsx` | — | Engineering |
| H4 | "Book now" is shown and does not read `care.home_visit_booking`. | `apps/mobile/src/app/patient/provider/[id].tsx` | — | Engineering |
| H5 | The home TetraSol card says "Approved … delivered" while checkout is off; "Approved" is ambiguous. | `packages/i18n/src/{en,ar}.ts` (`home.tetrasolBody`) | NEEDS_LEGAL_APPROVAL | Engineering + counsel |
| H6 | Home-care wording in the store listing. **Closed in the working tree:** subtitle, keyword and Play short description changed; the release check now blocks off-feature claims. | `store/metadata/*.json`; `scripts/release/brand-rules.ts` | STORE_METADATA_READY · NEEDS_LEGAL_APPROVAL | Marketing + counsel |
| H7 | The emergency notice appears on the Health tab only, and the number is compiled into the app. | `apps/mobile/src/features/compliance/Safety.tsx`; `packages/shared/src/compliance.ts` | — | Engineering |
| H8 | Credential expiry is not enforced; there is no document upload; the Syndicate lookup is not recorded. | migration `0004`; `apps/admin/src/app/verification/*` | — | Engineering |
| H9 | `evidence_ref` is free text, not linked to this register. | migration `0006`; `apps/admin/src/app/features/page.tsx` | — | Engineering + register owner |
| H10 | Products have no EDA registration field, and checkout is not gated on R11 or R12. | migration `0005` | — | Engineering |
| H11 | The "no-diagnosis limits" release check only looks for `123`. | `scripts/release/check.ts` | — | Engineering |
| H12 | No automated test asserts that `emergency-notice`, `call-emergency` or `medical-disclaimer` render. | `e2e/tests/*` | — | Engineering |
| H13 | The "Assistant name" row and the System status screen are visible to patients while their features are off (also `APPLE_APP_STORE_CHECKLIST.md`, section 7). | `apps/mobile/src/features/AccountScreen.tsx`; `apps/mobile/src/app/settings/system.tsx` | — | Engineering |
| H14 | In-app copy promises services that are off: welcome "Care that comes home" and "Verified doctors and nurses who come to you."; role descriptions "Offer consultations… follow your patients’ progress" and "Provide home nursing visits, follow care plans"; booking sheet "Online booking and payment arrive in the next release." | `packages/i18n/src/{en,ar}.ts` (`auth.*`, `roles.*`, `care.bookingSoonBody`) | NEEDS_LEGAL_APPROVAL | Engineering + counsel |
| H15 | Gold and Platinum show `REAL_WORLD` benefits (priority matching, reduced platform fees, enhanced booking benefits, priority support) although no matching, booking or fee exists. The draft Terms (working tree) say plans "unlock app features only". This bears on the intermediaries question (R8). Payment side: `PAYMENT_COMPLIANCE.md`, section 8. | migration `0007`; `apps/mobile/src/app/settings/subscription.tsx` | NEEDS_LEGAL_APPROVAL | Product + counsel |
| H16 | No age check on the account holder's own `SELF` profile or at sign-up, while the Terms require 18+. Minors exist only as guardian-managed profiles (`MINOR_REQUIRES_GUARDIAN_BASIS`). Also `GOOGLE_PLAY_CHECKLIST.md`, 5.5. | migration `0006` (`create_patient_profile`); `apps/mobile/src/app/onboarding/patient.tsx` | NEEDS_LEGAL_APPROVAL | Engineering + counsel |
| H17 | The draft privacy policy says clinicians see a record "only within an active care relationship you start", but no such relationship can be started in this build. The statement is a limit, but it implies a feature. | `packages/shared/src/legal.ts` | NEEDS_LEGAL_APPROVAL | Counsel |

---

## 13. Summary by category

| Category | Items |
|---|---|
| **Completed implementation** (`CODE_READY`) | Health-data consent enforced by the database (creation, profile edits, entry edits); disclaimer and emergency components on the Health tab; medical-disclaimer, Terms and health-consent documents (drafts) in the app and on the site; credential verification state machine with required credentials, written reasons, separation of duties, re-review and audit; admin verification console; seven server-side flags, all off, with a database CHECK, API guard, ADMIN-plus-MFA access and audit; admin Feature flags page; TetraSol-only store with approval-reference and demo-identifiability CHECKs; review-account isolation; RLS, append-only audit log, MFA for clinicians and staff in production, no iCloud entitlement, redacted crash reports. |
| **Verified by test** | `apps/api/test/compliance.test.ts`, `providers.test.ts`, `rls.test.ts`, `patients.test.ts`, `store.test.ts`, `auth.test.ts`, `billing.test.ts` (109/109 on the current tree); `scripts/release/check.ts`; E2E on the web build (not native): `flow-a-patient`, `flow-d-tetrasol`, `flow-e-admin`, `flow-f-privacy`, `a11y.spec.ts`. |
| **Verified by native build inspection** | Android release APK/AAB of 2026-10-15: `allowBackup=false`; no camera, location, audio or media permissions (`BUILT`). It is debug-signed and not distributable. No iOS binary exists. |
| **Requires a developer account** | Apple Organization enrollment and Google Organization account (D-U-N-S); age rating and category; Health apps declaration; Egypt-only availability; review accounts seeded in production; support domain for the disclaimer, privacy and deletion URLs. |
| **Requires official assets** | Final native screenshots (fictional data, no graphic wounds); official Alia Group and TetraSol logos; the real TetraSol catalogue from the brand owner. |
| **Requires legal approval** | All draft legal texts; disclaimer wording and its Arabic translation (H1, H2); in-app service wording (H14); TetraSol copy (H5); plan benefits (H15); age policy (H16); privacy-policy wording (H17); which entity submits and provides the services (5.1.1(ix)); the platform-fee and intermediaries model (R8); App Review notes. |
| **Requires regulatory evidence** | R1 to R15 in [section 11](#11-regulatory-evidence-register). None has evidence. Every regulated flag stays off until its items are filled and signed off. |
| **Requires Apple or Google review** | The store decisions only (10.7). **Approval would not be healthcare authorization** (section 1). |

---

## Official sources

All requirement URLs come from `docs/release/evidence/STORE_REQUIREMENTS_EVIDENCE.md` (verified 2026-10-14). Only `[verified-official]` findings are treated as requirements.

**Apple**
- [A1] App Review Guidelines, current version "Last Updated: June 8, 2026" (1.4.1, 1.4.2, 2.1, 2.3.x, 3.1.3(d), 3.1.3(e), 5.1.1(ix), 5.1.2(i), 5.1.3): https://developer.apple.com/app-store/review/guidelines/
- [A2] Apple Developer Program enrollment (Organization): https://developer.apple.com/programs/enroll/
- [A3] Declare regulated medical device status: https://developer.apple.com/help/app-store-connect/manage-app-information/declare-regulated-medical-device-status
- [A4] Age ratings values and definitions: https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions
- [A5] App Store categories: https://developer.apple.com/app-store/categories/
- [A6] App information (name and subtitle rules): https://developer.apple.com/help/app-store-connect/reference/app-information/app-information
- [A7] Guideline 2.3.3, screenshots: https://developer.apple.com/help/app-review/guideline-reference/2-3-3-screenshots
- [A8] Platform version information (description, App Review information, demo account): https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information

**Google Play**
- [G1] Health Content and Services policy (non-device disclaimer, consult a professional): https://support.google.com/googleplay/android-developer/answer/16679511
- [G2] Health apps declaration: https://support.google.com/googleplay/android-developer/answer/14738291
- [G3] Organization account required for health apps: https://support.google.com/googleplay/android-developer/answer/10788890
- [G4] Payments: regulated clinical services, 1:1 services, mixed SKUs: https://support.google.com/googleplay/android-developer/answer/10281818
- [G5] AI-Generated Content policy (**to confirm**; critique "additionally verified" item, not a `[verified-official]` finding): https://support.google.com/googleplay/android-developer/answer/13985936
- [G6] Health-sensitive permissions (camera, location, microphone): https://support.google.com/googleplay/android-developer/answer/13996367
- [G7] App access (sign-in details for reviewers): https://support.google.com/googleplay/android-developer/answer/9859455

**Egypt: official sources**
- [EG1] PDPC FAQ (health data is sensitive; licences and permits; cross-border transfer) `[verified-official]`: https://portal.pdpc.gov.eg/faq
- [EG3] Egyptian Medical Syndicate ethics code, Decree 238/2003 (Art. 15 `[verified-official]`; intermediaries provision `official-but-ambiguous`): https://ems.org.eg/laws/pdf/%D9%84%D8%A7%D9%8A%D9%94%D8%AD%D8%A9%20%D8%A7%D9%94%D8%AF%D8%A7%D8%A8%20%D8%A7%D9%84%D9%85%D9%87%D9%86%D8%A9.pdf
- [EG4] Medical Syndicate online inquiry `[verified-official]`: https://ems.org.eg/services/inquiry?type=specialties
- [EG8] EDA guideline EDREX:GL.CAMD.003 v03 (the medical-device definition includes application software) `[verified-official]`: https://www.edaegypt.gov.eg/media/jf2cxmo4/3-regulatory-guideline-of-the-procedures-and-rules-organizing-the-changes-done-to-a-registration-license-data-of-a-medical-device_gd.pdf

**Other sources cited (to confirm only; not requirements)**
- [EG2] UK FCDO, Egypt "Getting help" (emergency numbers), `official-but-ambiguous` (a foreign government): https://www.gov.uk/foreign-travel-advice/egypt/getting-help
- [EG5] Youm7 on the proposed Art. 15 amendment (2024), `could-not-verify`: https://www.youm7.com/story/2024/7/17/%D9%86%D9%82%D8%A7%D8%A8%D8%A9-%D8%A7%D9%84%D8%A3%D8%B7%D8%A8%D8%A7%D8%A1-%D8%AA%D9%8F%D8%AC%D8%B1%D9%89-%D8%AA%D8%B9%D8%AF%D9%8A%D9%84%D8%A7%D8%AA-%D8%B9%D9%84%D9%89-%D9%84%D8%A7%D8%A6%D8%AD%D8%A9-%D8%A2%D8%AF%D8%A7%D8%A8-%D8%A7%D9%84%D9%85%D9%87%D9%86%D8%A9-%D9%84%D8%AA%D9%82%D9%86%D9%8A%D9%86-%D8%A7%D9%84%D8%AA%D8%B7%D8%A8%D9%8A%D8%A8/6636951
- [EG6] Law 415/1954 Art. 1 (reproduction), `secondary-source-only`: https://lawyeregypt.net/?p=19367
- [EG7] Medical Liability and Patient Safety Law 13/2025, `secondary-source-only`: https://lawhub.info/eg/?p=10994
- [EG9] Andersen, telemedicine in Egypt (no dedicated law; Law 51/1981), `secondary-source-only`: https://eg.andersen.com/telemedicine-in-egypt/
- [EG10] Al Tamimi, Law 206/2017 on health advertising (critique item, law-firm summary): https://www.tamimi.com/law-update/november-7/articles/egyptian-law-promotion-healthcare-products-services/
- [EG11] PDPL Law 151/2020, Art. 12 (third-party bilingual copy), `secondary-source-only`: https://www.privacylaws.com/media/3263/egypt-data-protection-law-151-of-2020.pdf
