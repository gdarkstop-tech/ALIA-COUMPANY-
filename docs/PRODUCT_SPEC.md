# Dress My Wound (غير لي) — Product Specification

> **Status:** Source of truth for product scope. Preserved verbatim in substance from the
> master build prompt (2026-10-14). Changes to scope must be made here first and recorded in
> `docs/adr/`. Implementation progress is tracked in `docs/IMPLEMENTATION_CHECKLIST.md`.

---

## 1. Product vision

Dress My Wound is a premium healthcare and home-care platform designed initially for the
Egyptian market. The application connects:

**Patient ↔ Doctor ↔ Nurse ↔ Family ↔ Medical Records ↔ AI ↔ TetraSol**

Core product principle: **One Patient. One Care Team. One Medical Timeline.**

The application should feel like the user's personal healthcare home. A patient can manage
their own health, manage authorized family members, book doctors, request nurses, communicate
with a care team, track medical progress, use medical AI, and buy approved TetraSol products.

The experience must be premium, exceptionally easy to use, fast, trustworthy, and accessible.
Target audience: middle-upper-income and affluent Egyptian individuals and families, but the
essential healthcare experience must remain accessible.

## 2. Main roles

Three main user experiences: **PATIENT**, **DOCTOR**, **NURSE**.

Protected internal roles: **ADMIN**, **CLINICAL_REVIEWER**, **SUPPORT**, **TRUST_AND_SAFETY**,
**COMMERCE_MANAGER**.

Each role requires a distinct dashboard, navigation, permissions, and workflow.

## 3. UX first (most important rule)

Build an exceptionally polished application — not a generic dashboard template, not ugly
medical software with dozens of tables and confusing navigation. The patient should feel
comfortable using the app every day.

Design direction:

- Premium, modern healthcare aesthetic; warm white backgrounds.
- Calm teal and deep navy accents; very subtle warm secondary accents.
- Excellent Arabic typography; clear information hierarchy; spacious layouts.
- Soft, intentional animations; thoughtful microinteractions.
- Premium cards and illustrations where appropriate.
- Beautiful loading, empty, and error states.
- Large accessible touch targets; consistent navigation; responsive layouts.
- Light mode and dark mode; Arabic RTL and English LTR.
- No generic AI-looking gradients or unnecessary decoration.
- A proper design-token system so the appearance can evolve without rewriting components.
- Design all important states, not just the happy path.
- The application must feel simple even though its internal architecture is sophisticated.

## 4. Technical architecture

Preferred stack: TypeScript; React Native + Expo (Android/iOS); Expo Router; Next.js for the
admin/backoffice; TypeScript backend (Fastify, modular domain architecture); Better Auth;
PostgreSQL with Row Level Security and PostGIS; Drizzle ORM where compatible, with explicit SQL
migrations for security policies; Redis and background jobs when needed; private
S3-compatible storage; WebSocket/realtime; Zod validation; pnpm workspaces / Turborepo; Docker
Compose for local backend services; automated tests and CI.

Mobile and Next.js are separate applications sharing schemas, domain types, API clients, and
design tokens where practical. Verify compatible current versions against official
documentation before installation. Modular monolith, not microservices. Preserve sound
existing architecture; do not overwrite valuable code unnecessarily.

## 5. Authentication

Better Auth. Implement: secure sign-up/sign-in; email authentication; phone authentication and
OTP architecture; secure session handling; password recovery; rate limiting; secure
token/session storage on mobile; device/session management; MFA for doctors, nurses, and
privileged staff; proper role-based permissions; account verification. Use the official
Better Auth Expo integration. Never create a custom cryptographic authentication system.

## 6. Smart onboarding

Beautiful, progressive onboarding; never overwhelm users with long forms.

**Patient** (progressive): name, date of birth, sex where medically relevant, phone,
location, blood type if known, allergies, chronic conditions, current medications, previous
surgeries, existing medical reports, previous doctors if known, emergency contact. Optional
Health Check questionnaire for baseline information. Never pretend an online questionnaire
can determine blood type or establish a confirmed diagnosis. Medical information must
distinguish **patient-reported** from **professionally verified** information.

**Doctor:** identity, medical licence, medical degree, specialty, subspecialty,
certifications, years of experience, current hospital/clinic, previous experience, service
locations, consultation fees, working hours, availability. Professional information requires
verification before the provider becomes bookable.

**Nurse:** identity, nursing credentials, certifications, work history, hospital affiliation,
years of experience, professional skills, supported procedures, service area, working hours,
availability. Only verified nurses may accept real bookings.

Build an admin verification workflow.

## 7. Family health management (one of the most important features)

One account may manage multiple authorized patient profiles (Me, Mother, Father, Child, Add
Family Member). Each patient has their own medical record, care team, medications,
appointments, reports, medical history, notifications, AI context, and bookings. A person may
download the app to manage their parents and later use it for their own healthcare.

Fast profile switcher. Family Health Dashboard (e.g. "Mother — medication reminder due",
"Father — nurse visit tomorrow", "Me — doctor appointment Friday").

Implement appropriate adult consent, guardianship, delegated access, and revocation. Do **not**
automatically grant unrestricted access to another adult's medical records merely because
they are a family member.

## 8. Doctor and nurse discovery

Dedicated search with filters: specialty, service, location, distance, availability,
experience, verified ratings, price, gender preference, recommended providers. Premium
provider profiles: photo, qualifications, verified credentials, experience, specialty,
hospital affiliations, ratings, reviews, completed visits, services, prices, availability,
Book Now. Only show verified achievements.

## 9. Provider availability and capacity

Doctor statuses: Accepting New Patients · Limited Availability · Existing Patients Only ·
Fully Booked · Away / Vacation.

Nurse statuses: Available Now · Available Today · Scheduled Only · Fully Booked · Away.

Providers control working hours, maximum appointments, daily capacity, break times, vacation,
service radius, temporary unavailability. A fully booked provider remains discoverable
("Dr. Ahmed is currently fully booked.") with Next available appointment, Join Waitlist,
Notify Me, Find Similar Doctor. Waiting lists must integrate with real availability and
notifications.

## 10. Nurse Now

Patient chooses service, optional male/female preference, location, immediate or scheduled,
instructions. Show eligible nurses: verified profile, availability, distance, estimated
arrival, rating, experience, final service price. Flow: Choose Service → Find Nurse → View
Nurse → Confirm Booking → Pay → Track Arrival → Verify Visit → Complete. Do not invent live
provider availability or ETA.

## 11. Nursing services

Configurable catalog: blood pressure measurement; blood glucose measurement; wound dressing;
post-operative wound care; injections where authorized; elderly care; chronic disease
monitoring; home nursing; recurring nursing visits; custom nursing requests. Each service
has a defined scope, provider eligibility, duration, pricing rules, and any necessary clinical
authorization. Add recurring bookings, favorite nurses, backup nurse matching, visit history,
booking reminders.

## 12. Booking and payments

Online payments primary. Paymob preferred initial Egyptian gateway, behind a provider
abstraction. Support Visa/Mastercard, hosted secure checkout, booking payments, subscription
payments, refunds, payment status, provider settlement, financial records, webhook
verification, idempotent transactions. Never store raw card details. Payment success only
confirmed by trusted payment-provider verification. Without real credentials, a clearly
labelled local development/test adapter that never pretends a real charge occurred.

**Platform revenue:** configurable fees from completed services; providers have contractual
payout amounts; accurate financial ledger. Provider dashboard focuses on **NET** earnings
(Today: 3 completed visits / You earned 2,350 EGP; This week 11,400 EGP; Available for payout
8,750 EGP). Fees, deductions, taxes, and settlement terms must remain accurately disclosed in
agreements and statements.

## 13. Visit verification

Booking confirmation → provider arrival → optional location verification → rotating patient
PIN or QR → visit started → assigned tasks completed → clinical documentation → patient
completion confirmation → visit completed → provider payout eligibility. Multiple
verification signals, not GPS alone. Protect exact home addresses and location history.

## 14. Provider loyalty

Signals: completed verified bookings, punctuality, verified reviews, low cancellation rate,
documentation quality, response rate. Benefits: higher visibility, priority matching, reduced
platform fees, faster payouts, premium badges. All financial rules configurable.

## 15. Provider reviews and awards

Patients review doctors/nurses after completed verified bookings. Awards: Doctor/Nurse of the
Week/Month/Year, Patient Choice, Most Reliable, Fast Responder, specialty and location awards.
Fair ranking from verified reviews, booking volume, reliability, quality indicators — not
average stars. **No public patient star ratings.** Clinicians may file private safety or
operational incident reports for restricted platform review.

## 16. The care team (central differentiator)

Doctor + Nurse + Patient + Authorized Family Caregiver. Doctor: create care plan, recommend a
nurse, assign tasks, monitor observations, review progress, update follow-up. Patient may
accept the recommended nurse or select another eligible provider. Nurse: view assigned
patient information, perform authorized tasks, record vitals, upload permitted wound photos,
submit notes, communicate with the doctor. Access is linked to authorization, active care
relationships, and patient consent.

## 17. Chat and communication

Secure messaging: Patient↔Doctor, Patient↔Nurse, Doctor↔Nurse, authorized care-team
conversations. Text, photos, medical documents, attachments, notifications, read states.
Medical files private; do not expose permanent contact details unnecessarily.

## 18. Patient medical record

Structured longitudinal record: conditions, allergies, medications, vitals, lab results,
wound history, medical reports, doctor notes, nurse notes, care plans, appointments, visit
history, medical timeline. Every item has provenance and authorization. Designed for future
FHIR interoperability.

## 19. Smart dashboards

- **Patient:** today's health tasks, upcoming appointments, nurse arrivals, medication
  reminders, family health, recent reports, My Care Team, TetraSol, My AI Assistant.
- **Doctor:** today's appointments, active patients, care-plan progress, nurse updates,
  patients requiring review, messages, upcoming schedule, net earnings, AI assistant.
- **Nurse:** today's visits, next patient, visit location/time, authorized patient summary,
  assigned care tasks, doctor instructions, net earnings, upcoming appointments, loyalty
  status, AI assistant.

## 20. Subscriptions

- **SILVER — Free:** basic profile, basic family support, discovery, booking, medical record,
  TetraSol Store, basic AI with usage limits.
- **GOLD — 299 EGP/month (2,990 EGP/year):** self + up to 4 family profiles, advanced AI,
  enhanced family dashboard, priority matching, reduced eligible platform fees, advanced
  care-program management, lab explanation, enhanced reminders, weekly health summary,
  priority support.
- **PLATINUM — 699 EGP/month (6,990 EGP/year):** self + up to 8 family profiles, premium AI
  allowance, highest eligible matching priority, premium family management, advanced
  summaries, concierge-style support where staffed, enhanced booking benefits, maximum
  eligible subscription advantages.

All prices, benefits, and limits editable from Admin. Never promise unlimited real-world
healthcare visits — use capped credits, usage allowances, partner-funded benefits,
configurable discounts.

## 21. Care programs

Configurable programs (Wound Care, After Surgery, Diabetes, Elderly, Chronic) combining
doctor supervision, nurse visits, patient tasks, medication reminders, lab follow-up, wound
tracking, appropriate TetraSol products. Priced separately from memberships.

## 22. Critical commerce rule — TetraSol only

Replace the generic Smart Pharmacy concept entirely. The store is dedicated **exclusively** to
TetraSol and officially approved TetraSol products. No general pharmacy marketplace, no
competing products. Never fabricate TetraSol variants, formulations, prices, stock,
regulatory status, or therapeutic claims. Production catalog only from approved brand/company
information. Section name: **TetraSol Care**.

Build: catalog, product detail pages, approved information and instructions, variants, stock
status, prices, cart, Buy Now, secure checkout, order tracking, purchase history, Buy Again,
favorites, bundles, promo codes, loyalty offers, family purchasing, refill reminders, optional
recurring orders. Doctors and nurses may access the catalog and approved product information.

## 23. TetraSol sales growth engine

Buy Again; opt-in refill reminders; bundles of approved SKUs only; family purchases;
clinically appropriate doctor/nurse recommendations attached to care plans (never manipulate
clinical recommendations to increase sales); wound timeline integration (never attribute
improvement to a product without adequate evidence); QR onboarding for authorized packaging;
commerce analytics (product views, add-to-cart, checkout conversion, repeat purchase, refill
engagement, QR-to-app conversion, family purchase rate, subscription-to-commerce conversion).
Keep identifiable medical data out of ordinary marketing analytics.

## 24. Medical AI

Patient AI (user-named assistant): explain terminology, lab reports, authorized history,
medications, upcoming appointments, prepare doctor questions, care-plan instructions, service
navigation, approved TetraSol information. Doctor AI: timeline summaries, draft notes,
care-plan drafting, nurse update summaries, reference retrieval, trend review. Nurse AI:
patient summaries, task clarification, documentation drafts, handover summaries, safety
reminders. Provider-agnostic AI gateway and curated medical RAG. AI access follows the same
permission and consent controls as every feature. Never give an LLM unrestricted database
access. Clinical decisions remain under qualified professional oversight. AI must not
prescribe, diagnose definitively, or change treatment, and must not become a hidden TetraSol
salesperson.

## 25. Medical scanning

Lab scanner (extract names/values/units/reference intervals; explain; preserve originals;
flag for professional review). Wound tracking (dated images, timeline comparison, clinician
review; never claim unvalidated AI identifies infection/severity). Medical imaging (prepare
DICOM architecture; diagnostic imaging AI disabled until validated and authorized).

## 26. Scheduling and notifications

Unified scheduling for appointments, nurse visits, recurring visits, medication reminders,
lab appointments, care-plan tasks, provider availability. Notifications (appointment
tomorrow, nurse arriving soon, medication reminder, lab due, provider available again,
care-team update, opt-in TetraSol refill). Avoid notification spam.

## 27. Security and privacy

PostgreSQL RLS; server-side authorization; patient consent; role and care-team access
controls; provider credential verification; secure storage; encryption; signed file access;
audit logs; rate limiting; input validation; secure payment webhooks; secret isolation; MFA
for clinicians; cross-user access tests; safe error handling; backup and recovery procedures.
RLS must be effective with the chosen connection/role architecture — never bypass it with a
privileged application role. Never put real patient records in seed data or fixtures.
Sensitive medical operations are auditable.

## 28. Admin panel

Separate secure admin: users, doctors, nurses, professional verification, provider capacity,
bookings, care programs, nursing services, pricing, payouts, subscription plans, TetraSol
products, inventory, orders, payments, discounts, loyalty rules, reviews, safety reports,
notifications, AI feature flags, audit logs. Least-privilege administrative permissions.

## 29. Development and demo mode

Runnable locally. For unavailable integrations: correctly structured adapter, production
integration disabled, `NOT_CONFIGURED` displayed, clearly identified synthetic fixtures. Never
fabricate real payments, pharmacy inventory, professional verification, or medical AI
accuracy. Development showcase with synthetic Patient/Doctor/Nurse/Admin profiles. Demo mode
strictly isolated from production and unable to send real medical or payment actions.

## 30. Implementation strategy & milestones

Vertical slices: UI → authenticated API → database → permissions → tests.

- **M1 — Foundation:** monorepo; mobile app; backend API; schema & migrations; Better Auth;
  role permissions; initial RLS + tests; shared design system; Arabic/English; welcome &
  onboarding; role selection; sign-in/sign-up; patient profile & family switching;
  doctor/nurse onboarding; verification states; provider listing (synthetic data);
  capacity/status controls; patient/doctor/nurse dashboards; basic admin verification
  screen; TetraSol-only store UI on an approved-data-ready schema; navigation; env
  templates; local startup commands; automated smoke tests.
- **M2 — Core bookings:** search & matching, availability, waitlists, booking, Nurse Now,
  pricing, visit verification, payments, earnings, reviews, recurring visits, backup nurse.
- **M3 — Continuous care:** care teams, care plans, doctor–nurse collaboration, secure chat,
  vitals/observations, medical timeline, calendar, family management, notifications.
- **M4 — Commerce & monetization:** product management, cart/checkout, orders, Buy Again, QR,
  bundles, subscriptions, health credits, care programs, commerce analytics.
- **M5 — Medical AI:** AI gateway, patient assistant, doctor/nurse copilots, medical RAG,
  lab extraction, document explanations, wound documentation (diagnostic AI behind disabled
  flags).
- **M6 — Production hardening:** security & performance testing, accessibility audit,
  cross-platform testing, CI/CD, observability, deployment docs, backup/restore verification,
  clinical safety testing, integration verification.

## 31. Testing requirements

TypeScript checks, linting, unit, API, migration, authentication, RLS/security, role
isolation, UI smoke, booking state-transition (as implemented), payment webhook (as
implemented). Never report tests as passing unless executed successfully.

## 33. First success demonstration (M1 acceptance)

- **Flow A — Patient:** Sign in → Patient Home → My Health → Add Family Member → Switch
  Profile → Find Doctor → View Doctor Profile.
- **Flow B — Doctor:** Sign in → Doctor Dashboard → View Verification State → Edit
  Availability → Stop Accepting New Patients.
- **Flow C — Nurse:** Sign in → Nurse Dashboard → View Services → Change Availability → View
  Earnings UI.
- **Flow D — TetraSol:** Patient Home → TetraSol Care → Catalog → Product Details →
  Cart/Checkout Preview (simulated checkout clearly distinguished from real payment).
- **Flow E — Admin:** Admin Sign In → Provider Verification Queue → Review Credential
  Submission → Approve/Reject per authorized workflow.

## 34. Priorities

1. Patient safety and trustworthy healthcare behaviour. 2. Security and privacy.
3. Exceptional mobile UX. 4. Functional implementation. 5. Maintainable architecture.
6. Performance. 7. Reliable payments. 8. Strong TetraSol commerce. 9. Scalability.
10. Production readiness.
