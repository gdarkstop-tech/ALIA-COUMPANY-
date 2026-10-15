# Healthcare review readiness: Dress My Wound | غير لي

**Verified on: 2026-10-15**

This document covers the healthcare side of store review and launch for the iOS and Android app in `apps/mobile`, the API in `apps/api`, the admin console in `apps/admin` and the support site in `apps/site`. It looks at how accurately the app describes itself, its disclaimers, clinician verification, the gates on regulated features, Egyptian health regulation, the split between the store and clinical content, record security, and the regulatory evidence still missing.

- Requirements come only from `docs/release/evidence/STORE_REQUIREMENTS_EVIDENCE.md` (verified 2026-10-14). Keys such as [A1], [G1] and [EG3] point to [Official sources](#official-sources).
- Each statement about behaviour was checked against the file named on its line.
- Companion documents: `APPLE_APP_STORE_CHECKLIST.md`, `GOOGLE_PLAY_CHECKLIST.md`, `PRIVACY_AND_DATA_DISCLOSURES.md` and `PAYMENT_COMPLIANCE.md`. The overall status is in [`RELEASE_STATUS.md`](RELEASE_STATUS.md), which the lead engineer maintains. This document does not repeat it.
- This is not legal or regulatory advice. Every line marked **to confirm** needs Egyptian counsel or a regulator to confirm it.

> **Bottom line: the app is NOT ready for submission.**
> - **Approval by the App Store or Google Play is NOT healthcare authorization.** Store review checks compliance with Apple's and Google's own policies. It does not license a healthcare service in Egypt, register a medical device, approve health advertising or verify clinicians. See [section 1](#1-store-approval-is-not-healthcare-authorization).
> - Nothing has run on a physical or virtual device: there is no `/dev/kvm` and no macOS here. No iOS binary exists.
> - No Apple, Google or PDPC account exists. The legal entity name, support domain, support email, Apple Team ID, store product IDs and official logos are all **placeholders**.
> - All legal texts, including the medical disclaimer, are **DRAFT** (`LEGAL_DOCUMENT_STATUS = 'DRAFT_PENDING_LEGAL_REVIEW'`, version `2026-10-draft`).
> - Every regulated clinical feature is **off**, and none can be switched on until the [regulatory evidence register](#10-regulatory-evidence-register) has entries.
> - This review found **13 healthcare gaps**, listed in [section 11](#11-gaps-found-while-writing-this-document).

---

## 0. How to read this document

| Status | Meaning here |
|---|---|
| `CODE_READY` | Implemented in the repo (code, SQL or config). Not confirmed in a native binary unless the line says so. |
| `BUILT` | Confirmed in the locally built Android release APK/AAB (2026-10-15). |
| `STORE_METADATA_READY` | Text or asset is in `store/` and passes `scripts/release/check.ts`. |
| `NEEDS_ACCOUNT_ACTION` | Needs App Store Connect, Play Console, a domain, a mailbox or the PDPC portal. |
| `NEEDS_REGULATORY_EVIDENCE` | Needs evidence from an Egyptian authority or regulatory counsel: MoHP, EDA, Medical Syndicate, PDPC, or the health-advertising committee. |
| `NEEDS_LEGAL_APPROVAL` | Needs counsel sign-off. |
| `NEEDS_OFFICIAL_ASSETS` | Needs final brand files or final native screenshots. |
| `NEEDS_STORE_REVIEW` | Only Apple or Google can decide it. |
| `DEVICE_TESTED` · `READY_FOR_SUBMISSION` · `SUBMITTED` · `APPROVED` | **Not assigned to any line.** Nothing qualifies. |

A line marked **Gap Hx** has not reached `CODE_READY` or `STORE_METADATA_READY`. [Section 11](#11-gaps-found-while-writing-this-document) lists every gap.

**Verification labels:** `verified by automated test (<file>)` · `verified by native build inspection` · `verified by config inspection` (includes reading code and SQL) · `not verified`. E2E tests ran in Playwright against the Expo **web** build. They stand in for the native app but are not native, so these lines also say "(web)".

**Evidence confidence:** only `[verified-official]` findings are treated as requirements. Every other finding (`official-but-ambiguous`, `secondary-source-only`, `could-not-verify`, or untagged critique items) is labelled **to confirm**.

---

## 1. Store approval is not healthcare authorization

Approval from Apple or Google means only that a build meets that store's policies at review time. **It does not authorize Dress My Wound, Alia Group or any clinician to provide healthcare in Egypt.** The store rules themselves point to outside authorization:

| Store rule | What it says (`[verified-official]`) | Consequence for this app |
|---|---|---|
| Apple 1.4.1 [A1] | Medical apps get greater scrutiny. If the app has regulatory clearance, a link to that documentation must be submitted. | The company has no clearance and must not claim any. Apple reviewing the app does not create a clearance. |
| Google Health Content and Services [G1] | Regulated medical-device apps must declare that status and provide proof on request. Apps that are not devices must say they are not a medical device. | The app is presented as **not** a medical device. That position holds only while `ai.wound_assessment` and `clinical.diagnostic_suggestions` stay off (section 5). |
| Apple 5.1.1(ix) [A1] | Healthcare apps should be submitted by the legal entity that provides the services. | Which entity "provides the services" is a legal question (section 9). |

Authorization has to come from outside the stores. Every item below appears in the [register](#10-regulatory-evidence-register): MoHP (home-care and visit licensing, the emergency number), EDA (software and wound-care products as medical devices), the Medical Syndicate (ethics code, doctor registration), the PDPC (licence to process sensitive health data) and the health-advertising committee (Law 206/2017).

---

## 2. Clinical scope of this build: what the code does and does not do

| Capability | In this build? | Where | Flag (default) | Verification |
|---|---|---|---|---|
| Personal and family health record (allergies, conditions, medications, surgeries, blood type, emergency contact) | **Yes.** Every entry shows a provenance badge (self-reported, caregiver-reported or professionally verified). | `apps/mobile/src/app/patient/(tabs)/health.tsx` | none | verified by automated test (`apps/api/test/patients.test.ts`, `e2e/tests/flow-a-patient.spec.ts` (web)) |
| "Professionally verified" provenance | Users cannot set it. It cannot be forged through the app role. | migration `0006` `health_entries_guard` | none | verified by automated test (`apps/api/test/rls.test.ts`: "cannot forge professional verification of a health entry") |
| Discovery of verified doctors and nurses | **Yes.** Only `APPROVED` profiles appear, and licence numbers are never shown. | `apps/api/src/modules/providers/routes.ts`, view `app.public_provider_credentials` | none | verified by automated test (`apps/api/test/providers.test.ts`, `apps/api/test/rls.test.ts`) |
| Booking a home visit or consultation | **No.** "Book now" opens a "Booking opens soon" sheet: "Nothing has been booked or charged." | `apps/mobile/src/app/patient/provider/[id].tsx` | `care.home_visit_booking` (off). The UI does **not** read this flag (gap H4). | verified by config inspection |
| Video or remote consultation | **No.** No code exists. | — | `care.video_consultation` (off) | verified by config inspection |
| AI health assistant | **No.** The dashboard API returns `aiAssistant.status: 'NOT_CONFIGURED'`. Home shows a "Not configured" card. | `apps/api/src/modules/dashboard/routes.ts`, `apps/mobile/src/app/patient/(tabs)/index.tsx` | `ai.assistant` (off) | verified by config inspection |
| AI wound-photo assessment, camera, photo upload | **No.** No camera or image-picker dependency. `android.permission.CAMERA`, `RECORD_AUDIO` and location are in `blockedPermissions`. | `apps/mobile/app.config.ts` | `ai.wound_assessment` (off) | verified by native build inspection (Android permissions in the built manifest); verified by config inspection (iOS: no camera usage string in the generated Info.plist) |
| Automated diagnosis or triage suggestions | **No.** | — | `clinical.diagnostic_suggestions` (off) | verified by config inspection |
| Drug or dressing dosage calculators (Apple 1.4.2 [A1]) | **No.** | — | — | verified by config inspection |
| Clinician access to patient records | **No path exists.** `app.can_view_patient` grants access only through `patient_access` rows, which only the creating owner, guardian or caregiver holds. | migrations `0003`, `0006` | — | verified by automated test (`apps/api/test/rls.test.ts`: "patient data isolation") |
| TetraSol store | Browsing and cart work. Checkout is **simulated**: no payment, no order. | `apps/api/src/modules/store/routes.ts` | `commerce.checkout` (off) | verified by automated test (`apps/api/test/store.test.ts`: "checkout preview is explicitly simulated while payments are not configured") |

---

## 3. Accurate descriptions (store metadata and in-app copy)

Files: `store/metadata/en.json` (locale `en-GB`) and `store/metadata/ar.json`. Neither contains a diagnostic, healing or efficacy claim, a price, or a comparison with another app. Both say the app "does not diagnose or treat and is not an emergency service" and give 123.

| # | Item | Requirement (source) | State in repo | Status | Verification |
|---|---|---|---|---|---|
| 3.1 | No diagnostic or efficacy claims | `[verified-official]` No unverifiable product claims in the subtitle [A6]. Do not imply AI diagnosis. Use fictional data in screenshots and no graphic wound photos (2.3.x) [A1]. | No claims found in EN or AR. TetraSol is described as "wound-care products" with no therapeutic claim. | STORE_METADATA_READY, NEEDS_LEGAL_APPROVAL | verified by config inspection; verified by automated test (`scripts/release/check.ts`: length and keyword checks) |
| 3.2 | Play non-device disclaimer | `[verified-official]` The description must say the app is *"not a medical device and does not diagnose, treat, cure, or prevent any medical condition"* [G1]. | **Gap H1:** EN and AR say only "does not diagnose or treat". "Not a medical device", "cure" and "prevent" are missing. | Gap H1 (not yet STORE_METADATA_READY); then NEEDS_LEGAL_APPROVAL (AR translation) | verified by config inspection |
| 3.3 | "Consult a doctor" reminder in the store description | `[verified-official]` Apple 1.4.1: should remind users to check with a doctor [A1]. Google: must remind users to consult a healthcare professional [G1]. | **Gap H2:** neither description says this explicitly. | Gap H2; then NEEDS_LEGAL_APPROVAL | verified by config inspection |
| 3.4 | Home-care wording while booking is off | No specific rule in the evidence; **to confirm**. | **Gap H6:** the Apple subtitle "Family health & home care", the keyword "home visit" and the Play short description "verified home-care clinicians" all appear while `care.home_visit_booking` is off and MoHP licensing of home care is unknown (R5). | Gap H6; NEEDS_LEGAL_APPROVAL | verified by config inspection |
| 3.5 | Home-screen AI card | **To confirm** (1.4.1 scrutiny [A1] applies to medical apps generally). | **Gap H3:** `home.aiNotConfigured` reads "It will explain lab reports and medical terms in plain language". That describes interpretation of clinical results, which is not built and is gated by `ai.assistant`. The patient Me screen also has an "Assistant name" row (gap H13; see the Apple checklist, section 7). | Gap H3, Gap H13 | verified by config inspection |
| 3.6 | Home-screen TetraSol card | **To confirm** (Law 206/2017 R12; accuracy). | **Gap H5:** `home.tetrasolBody` reads "Approved TetraSol wound-care products, delivered." Delivery and checkout are not available, and "Approved" could be read as regulatory approval when it only means the brand owner approved the content. | Gap H5; NEEDS_LEGAL_APPROVAL | verified by config inspection |
| 3.7 | Clinician claims | Must match the code. | "Credentials have been reviewed by our team" is accurate: there is a manual admin review (section 4). The text claims no Syndicate integration and no outcome guarantee. The Terms say verification "is not a guarantee of clinical outcomes". | STORE_METADATA_READY, NEEDS_LEGAL_APPROVAL | verified by config inspection |
| 3.8 | Screenshots | `[verified-official]` App in use, fictional account data, suitable for a 4+ audience [A1]. | No final screenshots exist. Drafts from the web harness (`e2e/tests/store-screenshots.spec.ts`, `STORE_SHOTS=1`) use synthetic data and must be replaced by native captures. All visual assets are temporary placeholders. | NEEDS_OFFICIAL_ASSETS | not verified |
| 3.9 | Age rating | `[verified-official]` Frequent medical or treatment information gives 16+. Answers must be honest [A4]. | Not answered yet. Answer honestly in App Store Connect and in Play's IARC questionnaire. | NEEDS_ACCOUNT_ACTION | not verified |
| 3.10 | Category | `[verified-official]` Category definitions [A5]. | Recommended: Medical on both stores (see the Apple and Google checklists). | NEEDS_ACCOUNT_ACTION | not verified |
| 3.11 | Release check strength | — | **Gap H11:** the check "metadata states the emergency/no-diagnosis limits" only tests that `123` or `١٢٣` is present. It does not test for the disclaimer wording. | Gap H11 | verified by config inspection |

---

## 4. Disclaimers and emergency signposting

| # | Item | Requirement (source) | State in repo | Status | Verification |
|---|---|---|---|---|---|
| 4.1 | `MedicalDisclaimer` on the Health tab | `[verified-official]` Remind users to consult a professional [A1][G1]. | `apps/mobile/src/features/compliance/Safety.tsx` renders `safety.disclaimer` (EN: "Dress My Wound helps you organise information and reach verified clinicians. It does not diagnose or treat." AR: "يساعدك غير لي على تنظيم معلوماتك والوصول إلى مقدمي رعاية موثَّقين، ولا يقدم تشخيصًا أو علاجًا."). It is placed at the bottom of `patient/(tabs)/health.tsx`. **Gap H2:** it never explicitly says to consult a doctor. | CODE_READY (component); Gap H2 (wording) | verified by config inspection. The Health tab was rendered by `e2e/tests/a11y.spec.ts` (web), but the `medical-disclaimer` testID is **not asserted** (gap H12). |
| 4.2 | `EmergencyNotice` with `tel:123` on the Health tab | **To confirm:** 123 is `official-but-ambiguous` [EG2]. | Red "Not for emergencies" notice. The button calls `Linking.openURL('tel:123')` with a 44 pt minimum target. The number comes from `EMERGENCY_NUMBERS = { ambulance: '123' }` in `packages/shared/src/compliance.ts`. | CODE_READY, NEEDS_REGULATORY_EVIDENCE (R1) | verified by config inspection. The `emergency-notice` testID is not asserted (gap H12). The `tel:` handoff has not been tested on any device. |
| 4.3 | Fire and police numbers | Sources conflict: fire is 180 in the UK FCDO source and 125 on an AUC page. Whether 112 is live nationwide is unconfirmed [EG2]. | **Deliberately not shown.** Only the ambulance number 123 appears. | CODE_READY, NEEDS_REGULATORY_EVIDENCE (R1) | verified by config inspection |
| 4.4 | Where the emergency notice appears | **To confirm:** the evidence implication (an official-but-ambiguous finding) suggests patient screens, the AI assistant, booking and symptom entry [EG2]. | **Gap H7:** shown on the Health tab only, not on Care, the booking sheet, `AddEntrySheet` or home. The number is compiled into the app. The evidence suggests making it server-configurable; today a change needs an app release. | Gap H7 | verified by config inspection |
| 4.5 | Medical disclaimer document | `[verified-official]` reminders [A1][G1]. | `LEGAL_DOCUMENTS['medical-disclaimer']` in `packages/shared/src/legal.ts`, in EN and AR: self-reported data is not a diagnosis; no automated diagnosis or treatment advice "until clinical validation and regulatory approval"; call 123. Linked in Privacy & consent (`settings/privacy.tsx`) and published at `/medical-disclaimer` by `apps/site/build.ts`. The in-app screen shows a "draft" notice. | CODE_READY, NEEDS_LEGAL_APPROVAL, NEEDS_ACCOUNT_ACTION (support domain is a placeholder) | verified by config inspection |
| 4.6 | Terms: "Not an emergency or diagnostic service" | Same sources. | Terms of Use section: "In an emergency in Egypt call 123 (ambulance). Always follow the advice of a qualified clinician." | CODE_READY, NEEDS_LEGAL_APPROVAL | verified by config inspection |
| 4.7 | Support site footer | — | Every page of `apps/site`: "not an emergency service — in Egypt call 123 for an ambulance." | CODE_READY, NEEDS_ACCOUNT_ACTION (hosting and domain) | verified by config inspection |
| 4.8 | Explicit health-data consent before any health record | `[verified-official]` PDPL: health data is sensitive [EG1]. | Enforced in the database: `create_patient_profile` and `health_entries_guard` raise `HEALTH_DATA_CONSENT_REQUIRED`. The consent ledger is append-only. Withdrawing consent pauses new entries ("health-paused" notice). | CODE_READY, NEEDS_LEGAL_APPROVAL (consent text) | verified by automated test (`apps/api/test/compliance.test.ts`: "blocks health data until explicit health-data consent is given (database-enforced)", "withdrawing health-data consent stops new health entries; history stays append-only"; `e2e/tests/flow-a-patient.spec.ts`, `e2e/tests/flow-f-privacy.spec.ts` (web)) |

Before every release: re-confirm 123 with the Ministry of Health and Population (MoHP), using register item R1. Do not add other numbers until an Egyptian official source confirms them.

---

## 5. Clinician credential verification

### 5.1 Workflow as coded (migration `0004_providers_verification.sql`, `apps/api/src/modules/providers/routes.ts`, `apps/admin/src/app/verification/*`)

| # | Control | State in repo | Status | Verification |
|---|---|---|---|---|
| 5.1.1 | Required credentials | Doctors need `NATIONAL_ID`, `MEDICAL_LICENSE` and `MEDICAL_DEGREE`. Nurses need `NATIONAL_ID` and `NURSING_LICENSE` (`app.required_credential_kinds`, mirrored in `packages/shared`). | CODE_READY, NEEDS_REGULATORY_EVIDENCE (R9, R10: is this the right set?) | verified by automated test (`apps/api/test/rls.test.ts`: "SQL required-credential lists match the shared TypeScript constants") |
| 5.1.2 | State machine | `DRAFT → SUBMITTED` needs every required credential present and not rejected. `→ UNDER_REVIEW → APPROVED` needs every required credential `APPROVED`. `REJECTED`, `CHANGES_REQUESTED` and `SUSPENDED` need a written reason. Only an ADMIN can move between `APPROVED` and `SUSPENDED`. | CODE_READY | verified by automated test (`apps/api/test/providers.test.ts`: "cannot submit before required credentials are added", "requires a reason to reject or request changes", "cannot approve the provider until every required credential is approved", "a reviewer cannot suspend (admin-only transition)") |
| 5.1.3 | Separation of duties | A provider cannot approve themselves. Staff cannot edit credential data, only decide on it. Support staff can review but not decide. Reviewer ID and time are stamped on every decision. | CODE_READY | verified by automated test (`apps/api/test/rls.test.ts`: "a provider cannot approve or verify themselves", "support staff can review but not decide") |
| 5.1.4 | Re-review on material change | A change of specialty or display name after approval sends the profile back to `SUBMITTED`. | CODE_READY | verified by automated test (`apps/api/test/providers.test.ts`: "changing specialty after approval sends the profile back for review") |
| 5.1.5 | Patient visibility | Unverified providers are invisible. Patients see "verified" plus issuer and date, never licence numbers. | CODE_READY | verified by automated test (`apps/api/test/rls.test.ts`: "unverified providers are invisible to patients", "credentials (licence numbers) are not readable by patients") |
| 5.1.6 | Audit | History is written by a trigger. Audit events: `provider.verification.*`, `provider.credential.*`, `admin.provider_submission.viewed`. | CODE_READY | verified by automated test (`apps/api/test/providers.test.ts`: "records verification history and audit events"; `e2e/tests/flow-e-admin.spec.ts` (web)) |
| 5.1.7 | Admin console review | The verification queue and detail pages show kind, issuer, identifier and expiry, with approve or reject actions for each credential. | CODE_READY | verified by automated test (`e2e/tests/flow-e-admin.spec.ts` (web)) |

### 5.2 Gaps and open questions

| # | Item | Evidence | State | Status | Verification |
|---|---|---|---|---|---|
| 5.2.1 | Medical Syndicate lookup | `[verified-official]` ems.org.eg has an online doctor inquiry. No public API was found [EG4]. | No integration. Use it as a **manual** check. **Gap H8:** there is no field to record that the Syndicate lookup was done, by whom, or the result. Only the reviewer and time of the decision are stored. Do not claim automated Syndicate verification. | Gap H8; NEEDS_REGULATORY_EVIDENCE (R9) | verified by config inspection |
| 5.2.2 | MoHP practice licence and Syndicate registration | **To confirm** (`secondary-source-only`): Law 415/1954 requires both, and Law 153/2019 reportedly sets 5-year validity [EG6]. | One `MEDICAL_LICENSE` kind exists. There is no separate kind for Syndicate registration. | NEEDS_REGULATORY_EVIDENCE (R9), NEEDS_LEGAL_APPROVAL | verified by config inspection |
| 5.2.3 | Licence expiry | Implication of [EG6] (**to confirm**): block bookings when the licence has expired. | `expires_on` is captured and shown to the reviewer but **not enforced**: nothing suspends a provider or hides them when a licence expires (gap H8). This is required before `care.home_visit_booking` can go on. | Gap H8 | verified by config inspection |
| 5.2.4 | Credential documents | — | No upload exists. `document_object_key` is reserved ("secure storage arrives with M2/M3"). Reviewers see typed data only and must check the original documents outside the system. | Gap H8 | verified by config inspection |
| 5.2.5 | Nurse registration lookup | Unresolved: no Nursing Syndicate site or lookup was found. | Manual review only. | NEEDS_REGULATORY_EVIDENCE (R10) | not verified |
| 5.2.6 | Synthetic credentials in seed data | — | `apps/api/src/db/seed.ts` issues credentials from "Synthetic Demo Authority" with `DEMO-*` identifiers. It refuses to run in production or with `DEMO_MODE` off. `apps/api/src/db/seed-review.ts` creates **APPROVED** review doctor and nurse profiles ("Synthetic review profile — not a real clinician.", `is_demo = true`, `account_kind = 'REVIEW'`). The database owner inserts these directly, with **no credential rows**, and only review accounts can see them. Tell App Review this in the review notes. | CODE_READY, NEEDS_ACCOUNT_ACTION (run against production with a real domain and password) | verified by automated test (`apps/api/test/compliance.test.ts`: "review accounts see only synthetic catalogue rows; real accounts never see them", "users cannot promote themselves to a review account"); verified by config inspection |

---

## 6. Server-side feature flags (migration `0006_compliance_foundation.sql`)

| Key | Risk | Needs regulatory evidence | Default | Description in the migration | Register items |
|---|---|---|---|---|---|
| `ai.assistant` | HIGH | yes | **off** | Conversational health assistant; needs clinical-safety review, AI governance and regulatory assessment | R2, R3, R13 |
| `ai.wound_assessment` | HIGH | yes | **off** | AI analysis of wound photos; possible software as a medical device (SaMD) | R2 |
| `clinical.diagnostic_suggestions` | HIGH | yes | **off** | Any automated diagnostic or triage suggestion; needs a validation study | R2, R4 |
| `care.home_visit_booking` | MEDIUM | yes | **off** | Needs confirmation of MoHP licensing for the operating entity | R5, R6, R8, R9, R10 |
| `care.video_consultation` | MEDIUM | yes | **off** | Needs telemedicine licensing evidence | R7, R6 |
| `commerce.checkout` | MEDIUM | no | **off** | Paid TetraSol checkout via an external gateway | R11, R12 (process control only, see 6.2) |
| `billing.store_subscriptions` | MEDIUM | no | **off** | Apple IAP or Google Play Billing (see `PAYMENT_COMPLIANCE.md`) | — |

### 6.1 Controls

| # | Control | State in repo | Status | Verification |
|---|---|---|---|---|
| 6.1.1 | Database guard | `CONSTRAINT regulated_feature_needs_evidence CHECK (NOT enabled OR NOT requires_regulatory_evidence OR evidence_ref IS NOT NULL)`. This holds even when the API is bypassed. | CODE_READY | verified by automated test (`apps/api/test/compliance.test.ts`: "only admins manage flags, and HIGH-risk features need a regulatory evidence reference", a direct SQL update rejected with `regulated_feature_needs_evidence`) |
| 6.1.2 | API guard | `PATCH /v1/admin/features/:key` returns 422 `REGULATORY_EVIDENCE_REQUIRED` and needs the ADMIN role plus `enforceMfa`. | CODE_READY | verified by automated test (`apps/api/test/compliance.test.ts`) |
| 6.1.3 | Protected fields | The app role cannot change `risk`, `requires_regulatory_evidence` or `key` (`PROTECTED_FIELD`). Every change is audited as `feature.flag.updated` with from, to and `evidenceRef`. | CODE_READY | verified by automated test (`apps/api/test/compliance.test.ts`: audit rows counted) |
| 6.1.4 | All flags off by default | `GET /v1/system/features` returns every flag as `false`. Clients use `FEATURES_OFF` until the server answers (`useFeatures`). | CODE_READY | verified by automated test (`apps/api/test/compliance.test.ts`: "exposes every regulated feature as OFF by default") |
| 6.1.5 | Admin Feature flags page | `apps/admin/src/app/features/page.tsx` shows the key, description, risk badge, "evidence required" label, an evidence-reference input and an enable or disable button. | CODE_READY | verified by config inspection. There is no E2E test of this page. |
| 6.1.6 | Production configuration guard | The API refuses to boot in production with `DEMO_MODE`, dev tools or `MFA_ENFORCEMENT=warn`. | CODE_READY | verified by automated test (`apps/api/test/auth.test.ts`: "refuses to boot production with demo mode, dev tools, or MFA in warn mode") |

### 6.2 Limits of the flags (be precise in review notes)

- The flags are **gates set up in advance**. No AI, diagnostic, booking or video code exists yet, so switching a flag on today would not enable a feature. Any future feature must check its flag **on the server**. The UI is not enough: the "Book now" sheet already ignores `care.home_visit_booking` (gap H4).
- `evidence_ref` is free text of 3 to 300 characters. The database proves that **a reference was recorded**, not that the evidence is valid. **Gap H9:** nothing links the reference to the register. Proposed process control: `evidence_ref` must cite a register ID (for example `HCR-R2: <document reference>`), and the register owner signs off before an ADMIN enables the flag.
- `commerce.checkout` does not require regulatory evidence in the database, but EDA product registration (R11) and health-advertising approval (R12) still apply. Checkout is not gated on them today (gap H10).

---

## 7. Egyptian regulatory position

| # | Topic | Finding (confidence) | Source | What the code does | Status |
|---|---|---|---|---|---|
| 7.1 | Software as a medical device (SaMD) | `[verified-official]` EDA's definition of "medical device" covers **application software** meant for diagnosis, monitoring, treatment or alleviation of disease or injury (EDREX:GL.CAMD.003 v03, effective 2025-09-01). No dedicated EDA guideline on SaMD was found. | [EG8] | AI wound assessment would fall under this definition, so `ai.wound_assessment` stays off. The app makes no diagnostic claims. | NEEDS_REGULATORY_EVIDENCE (R2) |
| 7.2 | Remote diagnosis | `[verified-official]` Medical Syndicate ethics code, Decree 238/2003, **Art. 15**: a doctor may not firmly diagnose or recommend treatment from oral, written or visual data without examining the patient. | [EG3] | No remote diagnosis, chat, photo review or video exists. `care.video_consultation` and `clinical.diagnostic_suggestions` are off. Any future remote feature must be limited to triage, education and booking. | CODE_READY (absence verified by config inspection); NEEDS_LEGAL_APPROVAL for any future design |
| 7.3 | 2024 proposal to amend Art. 15 for telemedicine | **To confirm** (`could-not-verify`): there is no evidence it was adopted. | [EG5] | Do not build or market remote diagnosis on the assumption it was. | NEEDS_REGULATORY_EVIDENCE (R7) |
| 7.4 | Intermediaries, commissions and use of a doctor's name | **To confirm** (`official-but-ambiguous`; the article number is not legible): the code bars doctors from using intermediaries, from lending their name to commercial promotion, and from taking rewards for referrals or for prescribing products. | [EG3] | No clinician commission, referral or product-recommendation code exists, and the store shows no clinicians. **Needs counsel:** the ledger type `PLATFORM_FEE` (migration `0005`) and the Gold and Platinum benefits "Priority matching", "Reduced eligible platform fees" and "Enhanced booking benefits" (migration `0007`) may bear on the "intermediaries" prohibition. | NEEDS_LEGAL_APPROVAL, NEEDS_REGULATORY_EVIDENCE (R8) |
| 7.5 | Medical liability and informed consent | **To confirm** (`secondary-source-only`): Law 13/2025 counts consultations and nursing care as "medical services", requires written informed consent on the MoHP form, and requires membership of the medical-error insurance fund. | [EG7] | Not applicable while booking is off. No informed-consent capture exists. Before `care.home_visit_booking` goes on: provider terms covering consent, records and the insurance fund, and possibly support for capturing the MoHP form. The app must not replace the provider's own consent obligation. | NEEDS_REGULATORY_EVIDENCE (R6), NEEDS_LEGAL_APPROVAL |
| 7.6 | Health advertising | **To confirm** (critique item, based on a law-firm summary): Law 206/2017 requires prior approval from a dedicated committee to advertise health products or services. Penalties include imprisonment and fines of EGP 50,000 to 100,000. | [EG10] | TetraSol products appear to real users only with `content_status = 'APPROVED'` and an `approval_reference`, but that reference records **brand-owner** approval, not the committee's. Marketing consent is optional and unticked by default. No marketing push or email is sent. Store listing text, the home TetraSol card (gap H5) and any promotions need a counsel decision. | NEEDS_REGULATORY_EVIDENCE (R12), NEEDS_LEGAL_APPROVAL |
| 7.7 | Telemedicine law | **To confirm** (`secondary-source-only`): no dedicated Egyptian telemedicine or digital-health law, and no MoHP licensing decree, was found. | [EG9] | `care.video_consultation` is off. | NEEDS_REGULATORY_EVIDENCE (R7) |
| 7.8 | MoHP licensing of home care or a booking platform | **To confirm** (`secondary-source-only`, unresolved): Law 51/1981 licenses "places", and no decree for home-care companies was found. | [EG9] | `care.home_visit_booking` is off and requires an `evidence_ref`. Legal texts do not present the app as a healthcare provider. | NEEDS_REGULATORY_EVIDENCE (R5) |
| 7.9 | TetraSol products as medical devices | Implication of the `[verified-official]` EDA definition (**to confirm** per product): dressings are likely medical devices needing EDA registration or import approval. The registration status of TetraSol products is unconfirmed. | [EG8] | Seeded items are placeholders (`demo-*`, `PENDING_APPROVAL`, "No therapeutic claims"). **Gap H10:** there is no field for an EDA registration number. `regulatory_note` is free text. | NEEDS_REGULATORY_EVIDENCE (R11) |
| 7.10 | Health data under the PDPL | `[verified-official]` Health data is sensitive personal data, and a PDPC licence is required. | [EG1] | Health-data consent is enforced in the database (4.8). The full PDPL position is in `PRIVACY_AND_DATA_DISCLOSURES.md`, section 11. | CODE_READY (consent); NEEDS_REGULATORY_EVIDENCE (R13) |

---

## 8. Separation of commercial and clinical content

| # | Control | State in repo | Status | Verification |
|---|---|---|---|---|
| 8.1 | Store sells one brand only, by construction | `products.brand CHECK (brand = 'TetraSol')`. The store has its own tab with the notice "TetraSol Care sells TetraSol products only." | CODE_READY | verified by automated test (`apps/api/test/rls.test.ts`: "rejects any non-TetraSol product, even from a commerce manager") |
| 8.2 | Products shown only after approval | `CHECK approved_requires_reference`: `APPROVED` needs `approval_reference` and `approved_at`. Real users see only `APPROVED` items that are not demo items. | CODE_READY; NEEDS_OFFICIAL_ASSETS (real catalogue from the brand owner) | verified by automated test (`apps/api/test/rls.test.ts`: "cannot mark a product APPROVED without a brand approval reference") |
| 8.3 | Synthetic placeholders cannot pass as real | `CHECK demo_items_identifiable`: demo items must have a `demo-*` slug and can never be `APPROVED`. The UI shows "Synthetic placeholder … No therapeutic claims." Review accounts see only synthetic rows. | CODE_READY | verified by automated test (`apps/api/test/rls.test.ts`: "a demo product can never be flagged as brand-approved", "demo products are never visible outside demo mode"; `apps/api/test/store.test.ts`; `e2e/tests/flow-d-tetrasol.spec.ts` (web)) |
| 8.4 | No clinical endorsement of products | No code links a clinician to a product: no recommendation, commission or referral. Clinician profiles carry no product content. | CODE_READY (absence) | verified by config inspection |
| 8.5 | Health data not used for marketing | `[verified-official]` Apple 5.1.3 forbids using health data for advertising or marketing [A1]. No analytics or ad SDK is in `apps/mobile/package.json`. Marketing consent is separate and optional. No code selects products using health records. | CODE_READY, NEEDS_LEGAL_APPROVAL (privacy policy) | verified by config inspection |
| 8.6 | Payment class | Physical goods and clinical services use an external gateway, never IAP or Play Billing (`[verified-official]` [A1][G4]). Checkout is simulated and `commerce.checkout` is off. Details in `PAYMENT_COMPLIANCE.md`. | CODE_READY | verified by automated test (`apps/api/test/billing.test.ts`, `apps/api/test/store.test.ts`) |
| 8.7 | Placement next to health content | The home screen shows a TetraSol card below the health sections, and its copy has gap H5. The Health tab has no store content. | Gap H5 | verified by config inspection |

---

## 9. Secure records, submitter and review access

| # | Item | Requirement (source) | State in repo | Status | Verification |
|---|---|---|---|---|---|
| 9.1 | Row-level security on patient data | `[verified-official]` sensitive data [EG1]. | The app role is not a superuser, has no BYPASSRLS and owns no tables. Other users get 404. Medical records cannot be hard-deleted. | CODE_READY | verified by automated test (`apps/api/test/rls.test.ts`) |
| 9.2 | Audit log | — | Append-only (`forbid_mutation`). Readable only with `audit.read`. Covers patient profile, health entry, verification, feature flag and deletion events. | CODE_READY | verified by automated test (`apps/api/test/rls.test.ts`: "audit log is append-only and readable only with audit.read") |
| 9.3 | MFA for staff and clinicians | — | `MFA_REQUIRED_ROLES` covers clinician and staff roles. Enforced when `MFA_ENFORCEMENT=required`, which is mandatory in production. | CODE_READY | verified by automated test (`apps/api/test/auth.test.ts`: "blocks staff endpoints without two-factor when enforcement is required") |
| 9.4 | No device backup of medical data (Android) | — | `android:allowBackup=false` in the built manifest. | BUILT | verified by native build inspection |
| 9.5 | iOS privacy manifest declares health data | `[verified-official]` 5.1.3 disclosure [A1]. | `NSPrivacyCollectedDataTypeHealth` in `app.config.ts`. No iOS binary exists. | CODE_READY | verified by automated test (`scripts/release/check.ts`: "privacy manifest declares health data") |
| 9.6 | In-app account deletion | `[verified-official]` (see `PRIVACY_AND_DATA_DISCLOSURES.md`, section 7). | `app.delete_my_account`. Provider financial records are retained (`COMPLETED_WITH_RETENTION`). Retention periods are placeholders (R15). | CODE_READY, NEEDS_LEGAL_APPROVAL | verified by automated test (`apps/api/test/compliance.test.ts`: "account deletion" suite; `e2e/tests/flow-f-privacy.spec.ts` (web)) |
| 9.7 | Submitter is a legal entity | `[verified-official]` Apple 5.1.1(ix): healthcare apps should come from the legal entity that provides the services [A1]. Organization enrollment needs a legal entity, a D-U-N-S number, binding authority and a website [A2]. Google: health apps need an Organization account with a D-U-N-S number [G3]. | The legal entity is a placeholder (`<ALIA_GROUP_LEGAL_ENTITY_TO_CONFIRM>`). Counsel must decide **which entity provides the services**. The app does not present itself as a healthcare provider, and clinicians are individually licensed (7.8). | NEEDS_LEGAL_APPROVAL, NEEDS_ACCOUNT_ACTION | not verified |
| 9.8 | Review accounts | `[verified-official]` A demo account with a working backend [A1]. Play App access credentials [G3]. | `pnpm --filter @ghayarly/api review:seed` creates Patient, Doctor and Nurse accounts (`account_kind = 'REVIEW'`, synthetic catalogue only). The password must be at least 16 characters and is never committed. | CODE_READY, NEEDS_ACCOUNT_ACTION | verified by automated test (`apps/api/test/compliance.test.ts`: "review account isolation") |
| 9.9 | App Review notes on health scope | `[verified-official]` 1.4.1 [A1]. | Draft notes are in `APPLE_APP_STORE_CHECKLIST.md`, section 13.1. They must state: no diagnosis; AI is off; clinician profiles for review accounts are synthetic; checkout is simulated; no regulatory clearance is held or claimed. | NEEDS_LEGAL_APPROVAL, NEEDS_STORE_REVIEW | not verified |
| 9.10 | Play Health apps declaration | `[verified-official]` Every app must complete it. Do not select Medical Device unless regulated [G2]. | Proposed selections are in `GOOGLE_PLAY_CHECKLIST.md`, section 5.7a. | NEEDS_ACCOUNT_ACTION, NEEDS_LEGAL_APPROVAL | not verified |
| 9.11 | Apple regulated-medical-device declaration | `[verified-official]` Applies only in the EEA, UK and US [A3]. | Keep availability to Egypt only for v1. | NEEDS_ACCOUNT_ACTION | not verified |
| 9.12 | If AI is ever enabled | `[verified-official]` Apple 5.1.2(i): explicit permission before sharing data with third-party AI [A1]. Google AI-generated content reporting is **to confirm** (untagged critique item) [G5]. Health-sensitive permissions such as camera need prominent disclosure and consent [G7]. | Not applicable while `ai.*` is off and no camera exists. | NEEDS_REGULATORY_EVIDENCE (R3) | verified by config inspection |
| 9.13 | Final decision | Only Apple and Google decide whether the app passes their review. | — | NEEDS_STORE_REVIEW | not verified |

---

## 10. Regulatory evidence register

Every item has status **`NEEDS_REGULATORY_EVIDENCE`** and owner **TBD**. A flag's `evidence_ref` should cite the ID used here (6.2). No item has evidence yet.

| ID | Item: evidence needed | Required for | Evidence confidence today | Status | Owner | Evidence ref |
|---|---|---|---|---|---|---|
| R1 | Written MoHP confirmation of the ambulance number (123), and whether 112 is live | `EmergencyNotice`, medical disclaimer, Terms, store descriptions | official-but-ambiguous (UK FCDO) [EG2] | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R2 | EDA classification of AI wound assessment, the assistant and diagnostic suggestions as SaMD or not, plus registration if they are | `ai.wound_assessment`, `ai.assistant`, `clinical.diagnostic_suggestions`; Apple 1.4.1 clearance link; Play "Medical Device Apps" choice | verified-official definition [EG8]; no SaMD guideline | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R3 | Clinical-safety and AI governance assessment for the assistant: provider, data flows, report and flag controls | `ai.assistant` | Apple 5.1.2(i) verified-official [A1]; Google AI policy to confirm [G5] | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R4 | Clinical validation study for any triage or diagnostic output, with methodology disclosure | `clinical.diagnostic_suggestions` | Apple 1.4.1 verified-official [A1]; Decree 238/2003 Art. 15 verified-official [EG3] | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R5 | MoHP position on licensing the home-care or home-visit operation and the booking platform | `care.home_visit_booking`; home-care wording (gap H6) | secondary-source-only [EG9] | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R6 | Law 13/2025: the MoHP informed-consent form, the provider insurance-fund rules and the effective dates | `care.home_visit_booking`, `care.video_consultation`, provider terms | secondary-source-only [EG7] | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R7 | Telemedicine position: no law found; status of the Syndicate Art. 15 amendment | `care.video_consultation` | secondary-source-only / could-not-verify [EG9][EG5] | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R8 | Counsel opinion under the ethics code on intermediaries and commissions: platform fees, priority matching, discounted fees | Booking, `PLATFORM_FEE` ledger, Gold and Platinum benefits | official-but-ambiguous [EG3] | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R9 | Doctor credential standard: MoHP practice licence, Syndicate registration, validity period, and the EMS manual-lookup procedure | Provider approval; `care.home_visit_booking` | EMS lookup verified-official [EG4]; Law 415/1954 secondary [EG6] | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R10 | Nurse credential standard: Nursing Syndicate registration or licensing and how to verify it | Nurse approval; `care.home_visit_booking` | unresolved (not found) | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R11 | EDA registration or import approval for each TetraSol product, with its registration number | Product `APPROVED`; `commerce.checkout` | implication of the verified-official EDA definition [EG8]; status unconfirmed | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R12 | Law 206/2017 health-advertising committee approval, or counsel's view on whether it applies | TetraSol promotions, store listing text, home TetraSol card, marketing messages | critique item, law-firm summary [EG10] | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R13 | PDPC licence covering sensitive health data, plus a cross-border permit if hosting or an AI provider is outside Egypt | Launch with any health data; `ai.assistant` | verified-official [EG1] | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R14 | Limits on selling medicines or pharmacy products online, if any listed product is a medicine | Store catalogue | not verified (critique "missing") | NEEDS_REGULATORY_EVIDENCE | TBD | — |
| R15 | Statutory retention periods for medical and financial records | Account deletion summary, privacy policy | not verified (critique "missing") | NEEDS_REGULATORY_EVIDENCE | TBD | — |

---

## 11. Gaps found while writing this document

| ID | Gap | File | Fix owner |
|---|---|---|---|
| H1 | The Play non-device disclaimer wording ("not a medical device … cure, or prevent") is missing in EN and AR (also noted in `GOOGLE_PLAY_CHECKLIST.md`, 4.3). | `store/metadata/en.json`, `ar.json` | Engineering + counsel |
| H2 | No explicit "consult a doctor or healthcare professional" reminder in the store descriptions or on the Health tab. | `store/metadata/*.json`, `packages/i18n/src/{en,ar}.ts` (`safety.disclaimer`) | Engineering + counsel |
| H3 | The home AI card promises to "explain lab reports and medical terms" while `ai.assistant` is off. | `packages/i18n/src/{en,ar}.ts` (`home.aiNotConfigured`), `apps/mobile/src/app/patient/(tabs)/index.tsx` | Engineering |
| H4 | "Book now" is shown and does not read `care.home_visit_booking`. | `apps/mobile/src/app/patient/provider/[id].tsx` | Engineering |
| H5 | The home TetraSol card says "Approved … delivered" while checkout is off. "Approved" is ambiguous. | `packages/i18n/src/{en,ar}.ts` (`home.tetrasolBody`) | Engineering + counsel |
| H6 | Home-care and home-visit wording in the listing while booking is off and licensing is unknown. | `store/metadata/*.json` | Marketing + counsel |
| H7 | The emergency notice appears on the Health tab only, and the number is compiled into the app rather than server-configurable. | `apps/mobile/src/features/compliance/Safety.tsx`, `packages/shared/src/compliance.ts` | Engineering |
| H8 | Credential expiry is not enforced; there is no document upload and no record of the Syndicate lookup. | migration `0004`, `apps/admin/src/app/verification/*` | Engineering |
| H9 | `evidence_ref` is free text and not linked to this register. | migration `0006`, `apps/admin/src/app/features/page.tsx` | Engineering + register owner |
| H10 | Products have no EDA registration field, and checkout is not gated on R11 or R12. | migration `0005` | Engineering |
| H11 | The release check for "no-diagnosis limits" only checks for `123`. | `scripts/release/check.ts` | Engineering |
| H12 | No automated assertion that `emergency-notice`, `call-emergency` or `medical-disclaimer` render. | `e2e/tests/*` | Engineering |
| H13 | The "Assistant name" row is visible while `ai.assistant` is off (also in `APPLE_APP_STORE_CHECKLIST.md`, section 7). | `apps/mobile/src/features/AccountScreen.tsx` | Engineering |

---

## 12. Summary by category

| Category | Items |
|---|---|
| **Completed implementation** (`CODE_READY`) | Health-data consent enforced in the database; disclaimer and emergency components on the Health tab; medical-disclaimer, Terms and health-consent documents (draft) in the app and on the site; clinician verification state machine with required credentials, reasons, separation of duties and audit; seven regulated-feature flags all off, with a database CHECK, API guard, admin-only access, MFA and audit; admin Feature flags page; TetraSol-only store with approval-reference and demo-identifiability CHECKs; review-account isolation; row-level security, append-only audit log, MFA for staff and clinicians in production. |
| **Verified by test** | `apps/api/test/compliance.test.ts` (11 tests), `providers.test.ts`, `rls.test.ts`, `store.test.ts`, `auth.test.ts`, `billing.test.ts` (102 API tests passing on 2026-10-15); `scripts/release/check.ts` (46/46); E2E (web, not native): `flow-a-patient`, `flow-b-doctor`, `flow-d-tetrasol`, `flow-e-admin`, `flow-f-privacy`, `a11y.spec.ts`. |
| **Verified by native build** | Android release APK: `allowBackup=false`, no camera, location or audio permissions (`BUILT`). No iOS binary exists. |
| **Requires a developer account** | Apple Organization enrollment and Google Organization account (D-U-N-S); age rating and category; Health apps declaration; Egypt-only availability; review accounts seeded on production; support domain for the disclaimer and privacy URLs. |
| **Requires official assets** | Final native screenshots (fictional data, no graphic wounds); official Alia Group and TetraSol logos; real TetraSol catalogue from the brand owner. |
| **Requires legal approval** | All draft legal texts; disclaimer wording (H1, H2) and its Arabic translation; home-care wording (H6); TetraSol copy (H5); which entity is the submitter or service provider (5.1.1(ix)); the intermediaries and platform-fee model (R8); App Review notes. |
| **Requires regulatory evidence** | R1 to R15 in [section 10](#10-regulatory-evidence-register). None has evidence. Every regulated flag stays off until its items are filled and signed off. |
| **Requires Apple or Google review** | Store decisions only (9.13). **Approval would not be healthcare authorization** (section 1). |

---

## Official sources

Cited above. Keys match the evidence file `docs/release/evidence/STORE_REQUIREMENTS_EVIDENCE.md` (verified 2026-10-14).

**Apple**
- [A1] App Review Guidelines (1.4.1, 1.4.2, 2.1, 2.3.x metadata rules, 3.1.3, 5.1.1(ix), 5.1.2(i), 5.1.3): https://developer.apple.com/app-store/review/guidelines/
- [A2] Apple Developer Program enrollment (Organization): https://developer.apple.com/programs/enroll/
- [A3] Regulated medical device status declaration (EEA, UK, US): https://developer.apple.com/news/?id=nyqbfz1y
- [A4] Age ratings values and definitions: https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions
- [A5] App Store categories: https://developer.apple.com/app-store/categories/
- [A6] App information (name, subtitle rules): https://developer.apple.com/help/app-store-connect/reference/app-information/app-information

**Google Play**
- [G1] Health Content and Services policy (non-device disclaimer, consult a professional): https://support.google.com/googleplay/android-developer/answer/16679511
- [G2] Health apps declaration: https://support.google.com/googleplay/android-developer/answer/14738291
- [G3] Organization account for health apps; App access credentials: https://support.google.com/googleplay/android-developer/answer/10788890
- [G4] Payments: regulated clinical services and mixed SKUs: https://support.google.com/googleplay/android-developer/answer/10281818
- [G5] AI-Generated Content policy (**to confirm**, untagged critique item): https://support.google.com/googleplay/android-developer/answer/13985936
- [G7] Health-sensitive permissions (camera, location, microphone): https://support.google.com/googleplay/android-developer/answer/13996367

**Egypt**
- [EG1] PDPC FAQ (health data is sensitive; licences) `[verified-official]`: https://portal.pdpc.gov.eg/faq
- [EG2] UK FCDO, Egypt "Getting help" (emergency numbers) `official-but-ambiguous`: https://www.gov.uk/foreign-travel-advice/egypt/getting-help
- [EG3] Egyptian Medical Syndicate ethics code, Decree 238/2003 (Art. 15 `[verified-official]`; intermediaries provision `official-but-ambiguous`): https://ems.org.eg/laws/pdf/%D9%84%D8%A7%D9%8A%D9%94%D8%AD%D8%A9%20%D8%A7%D9%94%D8%AF%D8%A7%D8%A8%20%D8%A7%D9%84%D9%85%D9%87%D9%86%D8%A9.pdf
- [EG4] Medical Syndicate online inquiry `[verified-official]`: https://ems.org.eg/services/inquiry?type=specialties
- [EG5] Youm7 on the proposed Art. 15 amendment (2024) `could-not-verify`: https://www.youm7.com/story/2024/7/17/%D9%86%D9%82%D8%A7%D8%A8%D8%A9-%D8%A7%D9%84%D8%A3%D8%B7%D8%A8%D8%A7%D8%A1-%D8%AA%D9%8F%D8%AC%D8%B1%D9%89-%D8%AA%D8%B9%D8%AF%D9%8A%D9%84%D8%A7%D8%AA-%D8%B9%D9%84%D9%89-%D9%84%D8%A7%D8%A6%D8%AD%D8%A9-%D8%A2%D8%AF%D8%A7%D8%A8-%D8%A7%D9%84%D9%85%D9%87%D9%86%D8%A9-%D9%84%D8%AA%D9%82%D9%86%D9%8A%D9%86-%D8%A7%D9%84%D8%AA%D8%B7%D8%A8%D9%8A%D8%A8/6636951
- [EG6] Law 415/1954, Art. 1 (reproduction) `secondary-source-only`: https://lawyeregypt.net/?p=19367
- [EG7] Medical Liability and Patient Safety Law 13/2025 `secondary-source-only`: https://lawhub.info/eg/?p=10994
- [EG8] EDA guideline EDREX:GL.CAMD.003 v03 (medical-device definition includes application software) `[verified-official]`: https://www.edaegypt.gov.eg/media/jf2cxmo4/3-regulatory-guideline-of-the-procedures-and-rules-organizing-the-changes-done-to-a-registration-license-data-of-a-medical-device_gd.pdf
- [EG9] Andersen: telemedicine in Egypt (no dedicated law; Law 51/1981) `secondary-source-only`: https://eg.andersen.com/telemedicine-in-egypt/
- [EG10] Al Tamimi: Law 206/2017 on health advertising (critique item, law-firm summary): https://www.tamimi.com/law-update/november-7/articles/egyptian-law-promotion-healthcare-products-services/
