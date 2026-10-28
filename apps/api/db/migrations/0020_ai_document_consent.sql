-- 0020 — Separate, optional consent before a whole medical document (lab report, scan of a
-- report) is sent to an AI provider to be read (migration 0021). A document carries far more than
-- a typed question: names, identifiers, full results. Required in addition to the health-data
-- consent (to store the document) and withdrawable at any time. Kept in its own migration because
-- a new enum value cannot be used in the transaction that adds it.
ALTER TYPE app.consent_type ADD VALUE IF NOT EXISTS 'AI_DOCUMENT_PROCESSING';

UPDATE app.settings
   SET value = value || '{"AI_DOCUMENT_PROCESSING": "2026-10-draft"}'::jsonb
 WHERE key = 'consent.current_versions';
