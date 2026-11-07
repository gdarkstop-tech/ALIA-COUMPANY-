-- 0029 — AI provider states and kill switch (ADR 0019).
-- A provider's state is NOT_CONFIGURED (no business key in this environment), CONFIGURED (key set,
-- not verified), VERIFIED (the latest check with the current key succeeded), ERROR (it failed) or
-- DISABLED (switched off by an administrator, with a reason). Disabling is enforced by the database:
-- the router never receives a disabled provider, whatever the API passes.

CREATE TABLE app.ai_provider_controls (
  provider app.ai_provider PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  reason text CHECK (reason IS NULL OR length(reason) BETWEEN 3 AND 300),
  updated_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT disabled_needs_reason CHECK (enabled OR reason IS NOT NULL)
);
INSERT INTO app.ai_provider_controls (provider) SELECT unnest(enum_range(NULL::app.ai_provider));
ALTER TABLE app.ai_provider_controls ENABLE ROW LEVEL SECURITY;
-- Provider names and on/off are not sensitive; every request path needs to read them.
CREATE POLICY ai_provider_controls_read ON app.ai_provider_controls FOR SELECT TO ghayarly_app USING (true);
CREATE POLICY ai_provider_controls_write ON app.ai_provider_controls FOR UPDATE TO ghayarly_app
  USING (app.has_permission('ai.config.manage'))
  WITH CHECK (app.has_permission('ai.config.manage') AND updated_by_user_id = app.current_user_id());
GRANT SELECT ON app.ai_provider_controls TO ghayarly_app;
GRANT UPDATE (enabled, reason, updated_by_user_id, updated_at) ON app.ai_provider_controls TO ghayarly_app;

-- Every health check run from the console: what was checked, with which key (a short fingerprint
-- of the key and endpoint — never the key), and the outcome. Append-only.
CREATE TABLE app.ai_provider_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider app.ai_provider NOT NULL,
  model_id text NOT NULL CHECK (model_id ~ '^[A-Za-z0-9._:/-]{2,100}$'),
  ok boolean NOT NULL,
  detail text NOT NULL CHECK (length(detail) <= 200),
  key_fingerprint text CHECK (key_fingerprint IS NULL OR key_fingerprint ~ '^[0-9a-f]{12}$'),
  environment text NOT NULL CHECK (environment IN ('development', 'test', 'production')),
  checked_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ai_provider_checks_latest_idx ON app.ai_provider_checks (provider, checked_at DESC);
CREATE TRIGGER ai_provider_checks_append_only BEFORE UPDATE OR DELETE ON app.ai_provider_checks FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
ALTER TABLE app.ai_provider_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_provider_checks_read ON app.ai_provider_checks FOR SELECT TO ghayarly_app
  USING (app.has_permission('ai.config.manage') OR app.has_permission('ai.usage.read'));
CREATE POLICY ai_provider_checks_insert ON app.ai_provider_checks FOR INSERT TO ghayarly_app
  WITH CHECK (app.has_permission('ai.config.manage') AND checked_by_user_id = app.current_user_id());
GRANT SELECT, INSERT ON app.ai_provider_checks TO ghayarly_app;

-- The router's provider list, minus disabled providers. Every call into app.ai_reserve,
-- app.ai_route_status and app.ai_voice_start passes through this function.
CREATE FUNCTION app.ai_usable_providers(p_providers app.ai_provider[]) RETURNS app.ai_provider[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce(array_agg(p ORDER BY p), '{}'::app.ai_provider[])
  FROM unnest(p_providers) AS p
  WHERE NOT EXISTS (SELECT 1 FROM app.ai_provider_controls c WHERE c.provider = p AND NOT c.enabled)
$$;
REVOKE ALL ON FUNCTION app.ai_usable_providers(app.ai_provider[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ai_usable_providers(app.ai_provider[]) TO ghayarly_app;

-- The three router entry points keep their names and signatures but now always filter the
-- provider list: the original bodies become *_unfiltered, which the application role can no longer
-- call. (A later migration that changes routing must replace the *_unfiltered function.)
ALTER FUNCTION app.ai_reserve(text, integer, app.ai_provider[], integer, text) RENAME TO ai_reserve_unfiltered;
ALTER FUNCTION app.ai_route_status(text, app.ai_provider[], text) RENAME TO ai_route_status_unfiltered;
ALTER FUNCTION app.ai_voice_start(app.ai_provider[], text, uuid, text) RENAME TO ai_voice_start_unfiltered;
REVOKE ALL ON FUNCTION app.ai_reserve_unfiltered(text, integer, app.ai_provider[], integer, text) FROM PUBLIC, ghayarly_app;
REVOKE ALL ON FUNCTION app.ai_route_status_unfiltered(text, app.ai_provider[], text) FROM PUBLIC, ghayarly_app;
REVOKE ALL ON FUNCTION app.ai_voice_start_unfiltered(app.ai_provider[], text, uuid, text) FROM PUBLIC, ghayarly_app;

CREATE FUNCTION app.ai_reserve(p_route text, p_units integer, p_configured app.ai_provider[], p_request_chars integer DEFAULT NULL, p_language text DEFAULT 'ANY')
RETURNS TABLE (reservation_id uuid, candidates jsonb, max_output_tokens integer, tier app.ai_model_tier, weekly_limit integer, used integer, resets_at timestamptz)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT * FROM app.ai_reserve_unfiltered(p_route, p_units, app.ai_usable_providers(p_configured), p_request_chars, p_language)
$$;
CREATE FUNCTION app.ai_route_status(p_route text, p_configured app.ai_provider[], p_language text DEFAULT 'ANY')
RETURNS TABLE (feature_on boolean, internal_test boolean, consented boolean, route_on boolean, eligible integer, eligible_free integer, budget_ok boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT * FROM app.ai_route_status_unfiltered(p_route, app.ai_usable_providers(p_configured), p_language)
$$;
CREATE FUNCTION app.ai_voice_start(p_configured app.ai_provider[], p_language text, p_conversation uuid, p_ticket_hash text)
RETURNS TABLE (session_id uuid, provider app.ai_provider, model_id text, reserved_seconds integer, weekly_limit integer, used integer, resets_at timestamptz, max_output_tokens integer)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT * FROM app.ai_voice_start_unfiltered(app.ai_usable_providers(p_configured), p_language, p_conversation, p_ticket_hash)
$$;
REVOKE ALL ON FUNCTION app.ai_reserve(text, integer, app.ai_provider[], integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_route_status(text, app.ai_provider[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_voice_start(app.ai_provider[], text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ai_reserve(text, integer, app.ai_provider[], integer, text) TO ghayarly_app;
GRANT EXECUTE ON FUNCTION app.ai_route_status(text, app.ai_provider[], text) TO ghayarly_app;
GRANT EXECUTE ON FUNCTION app.ai_voice_start(app.ai_provider[], text, uuid, text) TO ghayarly_app;
