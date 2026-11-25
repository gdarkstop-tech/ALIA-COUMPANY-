# ADR 0021 — Appointments: doctor consultations and nurse home visits

- Status: accepted (2026-11-25) — implemented. All three booking flags are **off** by default
  (`care.clinic_booking`, `care.home_visit_booking`, `care.video_consultation`); turning on home
  visits needs documented regulatory evidence (Ministry of Health licensing of the operating entity).
- Code: migration `0031_appointments.sql`; `apps/api/src/modules/appointments/` (`routes.ts`,
  `notify.ts`); mobile `src/app/patient/book/[id].tsx`, `src/app/patient/appointments/*`,
  `src/app/clinician/appointments.tsx`, `src/app/clinician/appointment/[id].tsx`,
  `src/app/clinician/booking-settings.tsx`, `src/features/booking/*`.
- Tests: `apps/api/test/appointments.test.ts` (31).

## Context
Doctors and nurses had verified profiles, working hours and services, but nothing was bookable. Phase 8
asks for real booking with family members, confirmation, rescheduling, cancellation, reminders,
history and admin oversight, with no double booking, no time-zone errors, no stale or invented
availability, and no automatic assignment of unavailable nurses.

## Decision
1. **The database is the booking engine.** All writes go through SECURITY DEFINER functions
   (`appointment_request / respond / cancel / reschedule / progress / report_issue`,
   `appointments_expire`). The application role can only read appointments under RLS. The API maps
   the functions' stable error codes to HTTP answers (slot races and stale actions are 409).
2. **Only real availability.** `app.provider_slots` derives free slots from the provider's published
   working hours in **Africa/Cairo wall time** (converted with the PostgreSQL tz database, so Egyptian
   summer time is handled), stepped by the visit duration, ≥ 2 h ahead, ≤ 60 days ahead, minus time
   off, active bookings and days at the provider's daily cap. A request must name one of these exact
   slots or it is refused (`SLOT_NOT_AVAILABLE`). A provider with no hours shows `NO_SCHEDULE` and an
   empty list. Self-declared statuses (AWAY without a date, FULLY_BOOKED, EXISTING_PATIENTS_ONLY,
   paused) block booking; restricted or suspended providers are hidden from discovery entirely.
3. **No double booking, under any concurrency.** Exclusion constraints (btree_gist) forbid two active
   bookings overlapping for the same provider or the same patient. Requests for one provider also take
   a transaction-scoped advisory lock so the daily cap cannot be raced. Tested with ten parallel
   requests for one slot (exactly one wins) and with a direct SQL insert bypassing the API.
4. **States**: `REQUESTED → CONFIRMED → (IN_PROGRESS) → COMPLETED`, or `DECLINED` (reason required),
   `CANCELLED` (by patient side, provider with a reason, or operations with a reason — audited),
   `EXPIRED` (no answer within 24 h or 1 h before the start, worker every minute), `NO_SHOW`
   (≥ 15 min after start), `VISIT_FAILED` (home visits, with a category). Every change is written
   to `app.appointment_events`. Rescheduling (max 3): by the patient → back to `REQUESTED`; by the
   provider → `CONFIRMED` at the new time (the patient is told and can cancel).
5. **Who books for whom.** The booker must be able to edit the patient (self or a family profile
   managed under ADR 0003 consent rules). Providers cannot book themselves. Booking-restricted or
   inactive accounts cannot book.
6. **Prices.** Doctors publish consultation types (clinic, home visit; online is defined but refused
   with `VIDEO_NOT_CONFIGURED` because no telemedicine provider exists) with duration and price.
   Home nursing uses the **catalogue's approved price** of each service, not a nurse's own figure.
   The price is snapshotted on the booking; payment is `PAY_AT_VISIT` — no online payment for
   bookings, and nothing is described as paid.
7. **Home visits.** The company's launch governorates (`app.home_care_regions`, managed by operations,
   all off by default) and the provider's coverage areas (or their profile city) must both include the
   visit address. Services that need a prescription require the patient's attestation. The provider
   sees governorate and city before accepting and the street address and phone only after. Nobody is
   assigned automatically: every request names one provider, who accepts or declines. The app states
   that this is not an emergency service (call 123).
8. **Escalation.** A failed home visit (patient not available, address not found, unsafe, clinical
   escalation, provider unable) or a patient report (provider did not arrive, late, conduct, price)
   opens an `ops_incidents` row (CARE domain; HIGH for unsafe / clinical escalation / no-show /
   conduct). The incident holds the category and reference only; free text stays on the booking.
   Procedure: [docs/operations/HOME_VISIT_ESCALATION.md](../operations/HOME_VISIT_ESCALATION.md).
9. **Messages** (ADR 0020) are queued in the booking transaction: request → provider and patient;
   confirmation; decline; expiry; cancellation; reschedule; completion of home visits; reminders 24 h
   and 2 h before (cancelled and re-queued on changes). They contain the kind of visit, date, time
   in Cairo, provider name and reference — never the note, the service's clinical name or a reason.
   Contacts are resolved by a definer function and never returned to clients. Patients and providers
   may queue messages but never read the outbox: queueing and cancelling go through two narrow
   definer functions (`notification_enqueue`, `notifications_cancel_related`).
10. **Oversight and privacy.** Operations staff (`ops.read`) list bookings and incidents and can
    cancel with a reason; they never see notes, addresses or phone numbers. Commerce staff have no
    access to bookings and see only COMMERCE incidents. Display names are snapshotted on the booking
    so a provider never needs access to the patient's record. Account deletion cancels future
    bookings and removes notes, addresses and phone numbers from that person's past bookings. The
    admin user page shows how many open bookings a clinician holds before suspension.

## Not done / limits
- No online payment or deposit for bookings; no refund flow for bookings (nothing is collected).
- No video consultations (no licensed telemedicine provider).
- No automatic matching or dispatch, by design.
- Nurse-specific price approval is not implemented: the catalogue price applies.
- Reviews and ratings after visits are not part of this ADR.
