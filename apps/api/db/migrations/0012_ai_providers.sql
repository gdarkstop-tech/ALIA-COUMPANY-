-- 0012 — Additional AI providers (own migration: enum values must be committed before use).
--   QWEN     Alibaba Cloud Model Studio (OpenAI-compatible; workspace- and region-specific base URL)
--   GROK     xAI API (Responses API)
--   KIMI     Moonshot AI Kimi API (OpenAI-compatible Chat Completions)
--   MEDGEMMA Google MedGemma on a company-operated endpoint (self-hosted or Vertex AI), OpenAI-compatible
ALTER TYPE app.ai_provider ADD VALUE IF NOT EXISTS 'QWEN';
ALTER TYPE app.ai_provider ADD VALUE IF NOT EXISTS 'GROK';
ALTER TYPE app.ai_provider ADD VALUE IF NOT EXISTS 'KIMI';
ALTER TYPE app.ai_provider ADD VALUE IF NOT EXISTS 'MEDGEMMA';
