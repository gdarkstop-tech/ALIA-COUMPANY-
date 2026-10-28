# ADR 0012 — Health readings, calculated trends and grounded AI summaries

- Status: accepted (2026-10-28)
- Extends: [ADR 0008](0008-ai-gateway.md), [ADR 0011](0011-lab-report-reading.md)

## Context
Patients and caregivers want to record readings (blood pressure, glucose, weight, …), see how they
change, and get a plain-language summary. The project's rules require that measured data, calculated
trends, AI-generated interpretations and clinician-verified assessments are clearly distinguished,
and that patient improvements are never fabricated. A language model asked to "summarise my blood
pressure" will happily invent an average, call a trend "improving", or name a condition.

## Decision
1. **Readings** (`app.health_observations`): seven kinds with one fixed unit each (`mmHg`, `bpm`,
   `mg/dL`, `kg`, `°C`, `%`, `/10`); plausibility bounds in the database catch typing errors only
   (they are not clinical ranges); glucose may carry a context (fasting, after a meal, …). The
   health-entry rules apply: profile access by row-level security, the health-data consent,
   provenance derived by the database (patient vs caregiver), never deleted — marked
   `ENTERED_IN_ERROR` — and no change to a value after it is recorded. Notes are free text kept with
   the reading and are never sent to a model.
2. **Calculated trends** come from shared deterministic code (`seriesStats`): latest, previous,
   change, mean, lowest, highest, count. Lab trends use only lab results the person **confirmed**
   (ADR 0011) with a plain number; units are never mixed (a test in two units is two series); the
   status is against the range printed on the latest report. Changes are described as higher, lower
   or the same — never as better, worse or improving.
3. **AI summaries** (route `patient.health_summary`, flag `ai.health_summary` OFF and regulated,
   weekly `ANALYSES` allowance, clinical approval per model) are written only from **numbered facts**
   (`F1`, `F2`, …) that the app calculated. The model must return JSON points, each citing the facts
   it uses. The API rejects the answer (`checkHealthSummary`) unless every number in a point appears
   in the facts that point cites, questions contain no numbers, and no point claims improvement,
   normality, a condition, a medicine, a dose or a treatment (EN and AR patterns). Rejected answers
   are never shown; their tokens are recorded as company cost (`INVALID_OUTPUT`), the allowance is
   given back, and a person gets at most 5 paid failures a day.
4. **Storage and display**: the facts sent and the validated summary are stored together, so the app
   shows under every AI point the calculated facts it relied on, in the person's language. The four
   kinds of information carry distinct labels on screen: *Measured*, *Calculated*, *AI-generated*
   (with "not a medical assessment"), *Verified* (clinician; provenance `PROFESSIONALLY_VERIFIED`).
5. **Consent**: summaries use the AI assistant consent (the draft notice now describes them) plus the
   health-data consent; each summary is an explicit request.
6. **Evaluation**: summary cases carry synthetic readings placed before a fixed date; the executor
   builds the facts exactly as production does and screens answers with the same validator, plus
   language and forbidden-phrase checks. Six starter cases (EN/AR) are seeded as DRAFT.
7. **Charts**: one small line chart per measure (two lines for blood pressure, with a legend), 2 px
   lines and ringed markers, hairline grid, the printed lab range as a soft band, time mirrored in
   Arabic, tap-to-select as the touch tooltip, a table view, and a spoken summary for screen readers.
   Series colours are design tokens validated for both themes (lightness, chroma, colour-vision
   separation, contrast).

## Consequences
- No automatic alerts on extreme readings yet: thresholds (e.g. for very high blood pressure or very
  low glucose) need clinical sign-off and are a later step; the emergency notice is shown on the
  screen. Summary quality is **not evaluated** with any real model.
- Device integrations (Health Connect, HealthKit, Bluetooth meters) are out of scope; `source` is
  `MANUAL` only.
- Clinician-verified readings arrive with care relationships (Slice 7 / Milestone 3).
