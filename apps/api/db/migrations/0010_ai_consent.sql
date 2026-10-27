-- 0010 — Explicit, optional consent before anything a person types reaches an external AI provider.
-- Health questions are health data; the AI assistant (migration 0011) sends them to a provider the
-- business contracts with (sub-processor). This is separate from HEALTH_DATA_PROCESSING (storing
-- records in the app) and can be withdrawn at any time. Kept in its own migration because a new
-- enum value cannot be used in the transaction that adds it.
ALTER TYPE app.consent_type ADD VALUE IF NOT EXISTS 'AI_ASSISTANT_PROCESSING';

UPDATE app.settings
   SET value = value || '{"AI_ASSISTANT_PROCESSING": "2026-10-draft"}'::jsonb
 WHERE key = 'consent.current_versions';
