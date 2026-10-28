-- 0023 — Enum values for the clinician documentation copilot (migration 0024), in their own
-- migration because a new enum value cannot be used in the transaction that adds it.
--   * CLINICAL_DRAFTS: weekly allowance metric for AI-drafted clinical notes (company-paid tool).
--   * AI_CLINICAL_DOCUMENTATION: the clinician's acceptance that AI drafts are drafts — they review,
--     correct and sign every note and remain responsible for it.
ALTER TYPE app.ai_metric ADD VALUE IF NOT EXISTS 'CLINICAL_DRAFTS';
ALTER TYPE app.consent_type ADD VALUE IF NOT EXISTS 'AI_CLINICAL_DOCUMENTATION';

UPDATE app.settings
   SET value = value || '{"AI_CLINICAL_DOCUMENTATION": "2026-10-draft"}'::jsonb
 WHERE key = 'consent.current_versions';
