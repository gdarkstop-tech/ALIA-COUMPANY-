-- 0017 — Separate, optional consent before a person's voice is streamed to an AI provider
-- (migration 0018). Speaking is different from typing: the provider receives the audio itself, and
-- the person may be overheard. Required in addition to AI_ASSISTANT_PROCESSING; withdrawable at
-- any time. Kept in its own migration because a new enum value cannot be used in the transaction
-- that adds it.
ALTER TYPE app.consent_type ADD VALUE IF NOT EXISTS 'AI_VOICE_PROCESSING';

UPDATE app.settings
   SET value = value || '{"AI_VOICE_PROCESSING": "2026-10-draft"}'::jsonb
 WHERE key = 'consent.current_versions';
