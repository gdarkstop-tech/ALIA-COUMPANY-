-- 0018 — Realtime voice conversations with the health assistant (route `patient.voice`).
--
-- Design (ADR 0010):
--   * The app never talks to an AI provider. It streams microphone audio to our API over a
--     WebSocket and the API relays it with the business-owned key, so the policy, the emergency
--     check on every transcribed turn, metering and the hard stop all happen on the server.
--   * The stream is opened with a single-use ticket (valid 60 s) issued to the signed-in person
--     after every gate passed and the first block of seconds was reserved; only its SHA-256 hash is
--     stored.
--   * Weekly voice seconds are reserved in blocks of at most 30 s while the conversation is live,
--     under the same per-person lock as every AI request. When the allowance is spent (or consent
--     is withdrawn, the route switched off, the budget spent) no further block is granted and the
--     server ends the stream. Sessions last at most 10 minutes.
--   * Settlement uses the seconds actually streamed and the provider-reported audio and text tokens
--     (input transcription included) priced from the registry. Abandoned sessions are settled from
--     their last heartbeat.
--   * Only text transcripts are kept, as messages of the person's conversation. Audio is never stored.

-- ------------------------------------------------------------------ feature flag
INSERT INTO app.feature_flags (key, enabled, risk, requires_regulatory_evidence, description) VALUES
  ('ai.voice', false, 'HIGH', true, 'Realtime voice conversations with the health assistant. Needs the ai.assistant evidence plus a voice review: Arabic (Egyptian) speech recognition accuracy, emergency detection on transcripts, audio privacy disclosures.');

-- ------------------------------------------------------------------ registry: audio prices
-- USD per 1,000,000 audio tokens, in micro-dollars. Text tokens keep the existing columns.
ALTER TABLE app.ai_models
  ADD COLUMN audio_input_price_micros bigint CHECK (audio_input_price_micros IS NULL OR audio_input_price_micros >= 0),
  ADD COLUMN audio_output_price_micros bigint CHECK (audio_output_price_micros IS NULL OR audio_output_price_micros >= 0),
  ADD COLUMN audio_cache_read_price_micros bigint CHECK (audio_cache_read_price_micros IS NULL OR audio_cache_read_price_micros >= 0),
  ADD CONSTRAINT active_voice_model_is_priced CHECK (NOT active OR provider = 'SIMULATED' OR NOT ('REALTIME_VOICE' = ANY (capabilities))
    OR (audio_input_price_micros IS NOT NULL AND audio_output_price_micros IS NOT NULL));
GRANT UPDATE (audio_input_price_micros, audio_output_price_micros, audio_cache_read_price_micros) ON app.ai_models TO ghayarly_app;

-- An audio price edit clears the verification, like a text price edit (fires before ai_models_audit).
CREATE FUNCTION app.ai_models_audio_price_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  IF current_user = 'ghayarly_app'
     AND (NEW.audio_input_price_micros, NEW.audio_output_price_micros, NEW.audio_cache_read_price_micros)
         IS DISTINCT FROM (OLD.audio_input_price_micros, OLD.audio_output_price_micros, OLD.audio_cache_read_price_micros)
     AND NEW.price_verified_at IS NOT DISTINCT FROM OLD.price_verified_at THEN
    NEW.price_verified_at := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_models_audio_price BEFORE UPDATE ON app.ai_models FOR EACH ROW EXECUTE FUNCTION app.ai_models_audio_price_guard();

-- Reference rows from developers.openai.com/api/docs/pricing (fetched 2026-10-27). INACTIVE and
-- UNVERIFIED until an administrator confirms availability and price for the company account.
INSERT INTO app.ai_models (provider, model_id, display_name, input_price_micros, output_price_micros, cache_read_price_micros,
                           audio_input_price_micros, audio_output_price_micros, audio_cache_read_price_micros, price_source, capabilities, hosting, notes) VALUES
  ('OPENAI', 'gpt-realtime-2.1', 'GPT Realtime 2.1', 4000000, 24000000, 400000, 32000000, 64000000, 400000,
   'developers.openai.com/api/docs/pricing, text and audio tokens (fetched 2026-10-27) — verify before activating', ARRAY['REALTIME_VOICE'], 'PROVIDER_API',
   'Speech-to-speech through the Realtime API, relayed by the server. Arabic (Egyptian) speech quality and safety must be evaluated before patient use.'),
  ('OPENAI', 'gpt-realtime-2.1-mini', 'GPT Realtime 2.1 mini', 600000, 2400000, 60000, 10000000, 20000000, 300000,
   'developers.openai.com/api/docs/pricing, text and audio tokens (fetched 2026-10-27) — verify before activating', ARRAY['REALTIME_VOICE'], 'PROVIDER_API',
   'Economical realtime voice model. Evaluate separately: it is not approved by the approval of the larger model.'),
  ('OPENAI', 'gpt-4o-mini-transcribe', 'GPT-4o mini Transcribe', 1250000, 5000000, NULL, NULL, NULL, NULL,
   'developers.openai.com/api/docs/pricing, transcription (fetched 2026-10-27; also listed as ~$0.003 / minute) — verify', ARRAY['SPEECH_TO_TEXT'], 'PROVIDER_API',
   'Transcribes the person''s speech inside voice sessions (used for the emergency check and the transcript). Priced per token from the session usage.');
INSERT INTO app.ai_models (provider, model_id, display_name, input_price_micros, output_price_micros, audio_input_price_micros, audio_output_price_micros,
                           price_source, capabilities, hosting, notes, active) VALUES
  ('SIMULATED', 'simulated-voice', 'Simulated voice (development only)', 0, 0, 0, 0, 'Not a real provider', ARRAY['REALTIME_VOICE'], 'LOCAL',
   'Development stand-in: answers with a short tone and a labelled transcript. Never available in production.', true);

-- ------------------------------------------------------------------ route
INSERT INTO app.ai_routes (key, description, feature_flag, metric, max_output_tokens, carries_patient_data, required_capability, require_clinical_approval, max_concurrent_per_user) VALUES
  ('patient.voice', 'Realtime voice conversation with the health assistant. Same policy as patient.chat; every transcribed turn is checked for emergencies before the model may answer.',
   'ai.voice', 'VOICE_SECONDS', 1024, true, 'REALTIME_VOICE', true, 1);
-- Suggested candidates (models are inactive until verified and approved; administrators can change them).
INSERT INTO app.ai_route_candidates (route_key, tier, model, priority, effort)
SELECT 'patient.voice', t.tier, m.id, t.priority, 'medium'
FROM (VALUES ('BASIC'::app.ai_model_tier, 'gpt-realtime-2.1-mini', 10), ('ADVANCED'::app.ai_model_tier, 'gpt-realtime-2.1-mini', 10),
             ('PREMIUM'::app.ai_model_tier, 'gpt-realtime-2.1', 10), ('PREMIUM'::app.ai_model_tier, 'gpt-realtime-2.1-mini', 20)) AS t(tier, model_id, priority)
JOIN app.ai_models m ON m.provider = 'OPENAI' AND m.model_id = t.model_id;

-- ------------------------------------------------------------------ transcripts are conversation messages
ALTER TABLE app.ai_messages ADD COLUMN channel text NOT NULL DEFAULT 'TEXT' CHECK (channel IN ('TEXT', 'VOICE'));
DROP POLICY ai_messages_insert ON app.ai_messages;
-- The app may write only the person's own typed words; voice transcripts come from app.ai_voice_record().
CREATE POLICY ai_messages_insert ON app.ai_messages FOR INSERT TO ghayarly_app
  WITH CHECK (user_id = app.current_user_id() AND role = 'user' AND kind = 'MESSAGE' AND channel = 'TEXT' AND usage_id IS NULL AND provider IS NULL
              AND EXISTS (SELECT 1 FROM app.ai_conversations c WHERE c.id = conversation_id AND c.user_id = app.current_user_id()));

-- ------------------------------------------------------------------ voice sessions
CREATE TABLE app.ai_voice_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE,
  -- Kept when the conversation is deleted: the session holds no content, only metering.
  conversation_id uuid REFERENCES app.ai_conversations (id) ON DELETE SET NULL,
  usage_id uuid NOT NULL UNIQUE REFERENCES app.ai_usage (id) ON DELETE CASCADE,
  provider app.ai_provider NOT NULL,
  model_id text NOT NULL,
  locale text NOT NULL CHECK (locale IN ('ar', 'en')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'STREAMING', 'ENDED')),
  -- SHA-256 (hex) of the single-use stream ticket; cleared once the stream is opened.
  ticket_hash text CHECK (ticket_hash IS NULL OR ticket_hash ~ '^[0-9a-f]{64}$'),
  ticket_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  ended_at timestamptz,
  used_seconds int NOT NULL DEFAULT 0 CHECK (used_seconds BETWEEN 0 AND 3600),
  -- Provider-reported token counts (no content): textIn, textOut, cachedText, audioIn, audioOut,
  -- cachedAudio, transcribeIn, transcribeOut, transcriptionModel.
  usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  end_reason text CHECK (end_reason IS NULL OR end_reason IN ('USER_ENDED', 'QUOTA', 'MAX_DURATION', 'IDLE', 'DISCONNECTED', 'PROVIDER_ERROR', 'EMERGENCY', 'STOPPED', 'LOST', 'EXPIRED', 'SERVER_SHUTDOWN')),
  CONSTRAINT ended_has_reason CHECK ((status = 'ENDED') = (end_reason IS NOT NULL AND ended_at IS NOT NULL))
);
CREATE INDEX ai_voice_sessions_user_idx ON app.ai_voice_sessions (user_id, created_at DESC);
CREATE INDEX ai_voice_sessions_open_idx ON app.ai_voice_sessions (status, heartbeat_at) WHERE status <> 'ENDED';
ALTER TABLE app.ai_voice_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_voice_sessions_select ON app.ai_voice_sessions FOR SELECT TO ghayarly_app
  USING (user_id = app.current_user_id() OR app.has_permission('ai.usage.read'));
GRANT SELECT ON app.ai_voice_sessions TO ghayarly_app;
-- No write grants: only the functions below change sessions.

-- ------------------------------------------------------------------ helpers
CREATE FUNCTION app.ai_jnum(p jsonb, p_key text) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof(p -> p_key) = 'number' THEN greatest(0, floor((p ->> p_key)::numeric)) ELSE 0 END
$$;

-- Budget alerts (first crossing of 50 / 80 / 100 % this month) for the company and a plan.
CREATE FUNCTION app.ai_check_budget_alerts(p_plan app.plan_code) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_month date := (date_trunc('month', now() AT TIME ZONE 'Africa/Cairo'))::date;
  v_limit bigint;
  v_spend bigint;
  v_pct int;
BEGIN
  SELECT monthly_limit_micros INTO v_limit FROM app.ai_budget;
  IF v_limit IS NOT NULL AND v_limit > 0 THEN
    v_spend := app.ai_month_spend();
    FOREACH v_pct IN ARRAY ARRAY[50, 80, 100] LOOP
      IF v_spend * 100 >= v_limit * v_pct THEN
        INSERT INTO app.ai_budget_alerts (scope, month, threshold_pct, spend_micros, limit_micros) VALUES ('COMPANY', v_month, v_pct, v_spend, v_limit) ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;
  IF p_plan IS NULL THEN RETURN; END IF;
  SELECT plan_monthly_limit_micros INTO v_limit FROM app.ai_plan_budgets WHERE plan_code = p_plan;
  IF v_limit IS NOT NULL AND v_limit > 0 THEN
    v_spend := app.ai_month_spend_by(NULL, p_plan);
    FOREACH v_pct IN ARRAY ARRAY[50, 80, 100] LOOP
      IF v_spend * 100 >= v_limit * v_pct THEN
        INSERT INTO app.ai_budget_alerts (scope, plan_code, month, threshold_pct, spend_micros, limit_micros) VALUES ('PLAN', p_plan, v_month, v_pct, v_spend, v_limit) ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;
END $$;

/*
 * Ends a session and settles its usage: the seconds actually streamed (never more than reserved)
 * and the provider-reported tokens priced from the registry. The input-transcription model is
 * priced from its own row; without a price, or with an unverified one, the cost is marked estimated.
 * Idempotent. Internal: called by ai_voice_settle (the owner) and ai_voice_reap.
 */
CREATE FUNCTION app.ai_voice_finish(p_session uuid, p_seconds int, p_usage jsonb, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_s app.ai_voice_sessions;
  v_use app.ai_usage;
  v_m app.ai_models;
  v_t app.ai_models;
  u jsonb := coalesce(p_usage, '{}'::jsonb);
  v_seconds int;
  v_cost numeric;
  v_estimated boolean;
  v_in bigint;
  v_out bigint;
  v_cached bigint;
BEGIN
  SELECT * INTO v_s FROM app.ai_voice_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_VOICE_SESSION_INVALID' USING ERRCODE = 'P0001'; END IF;
  IF v_s.status = 'ENDED' THEN RETURN; END IF;
  SELECT * INTO v_use FROM app.ai_usage WHERE id = v_s.usage_id FOR UPDATE;
  v_seconds := CASE WHEN v_s.status = 'PENDING' THEN 0 ELSE least(greatest(coalesce(p_seconds, 0), v_s.used_seconds, 0), v_use.units) END;

  SELECT * INTO v_m FROM app.ai_models WHERE provider = v_s.provider AND model_id = v_s.model_id;
  v_cost := (app.ai_jnum(u, 'textIn') * coalesce(v_m.input_price_micros, 0)
           + app.ai_jnum(u, 'textOut') * coalesce(v_m.output_price_micros, 0)
           + app.ai_jnum(u, 'cachedText') * coalesce(v_m.cache_read_price_micros, v_m.input_price_micros, 0)
           + app.ai_jnum(u, 'audioIn') * coalesce(v_m.audio_input_price_micros, 0)
           + app.ai_jnum(u, 'audioOut') * coalesce(v_m.audio_output_price_micros, 0)
           + app.ai_jnum(u, 'cachedAudio') * coalesce(v_m.audio_cache_read_price_micros, v_m.audio_input_price_micros, 0)) / 1000000;
  v_estimated := v_s.provider <> 'SIMULATED' AND v_m.price_verified_at IS NULL;
  IF app.ai_jnum(u, 'transcribeIn') + app.ai_jnum(u, 'transcribeOut') > 0 THEN
    SELECT * INTO v_t FROM app.ai_models WHERE provider = v_s.provider AND model_id = u ->> 'transcriptionModel';
    IF NOT FOUND OR v_t.input_price_micros IS NULL THEN
      v_estimated := true; -- transcription billed by the provider but not priced here: cost understated
    ELSE
      v_cost := v_cost + (app.ai_jnum(u, 'transcribeIn') * v_t.input_price_micros + app.ai_jnum(u, 'transcribeOut') * coalesce(v_t.output_price_micros, 0)) / 1000000;
      v_estimated := v_estimated OR v_t.price_verified_at IS NULL;
    END IF;
  END IF;
  v_in := app.ai_jnum(u, 'textIn') + app.ai_jnum(u, 'audioIn') + app.ai_jnum(u, 'transcribeIn');
  v_out := app.ai_jnum(u, 'textOut') + app.ai_jnum(u, 'audioOut') + app.ai_jnum(u, 'transcribeOut');
  v_cached := app.ai_jnum(u, 'cachedText') + app.ai_jnum(u, 'cachedAudio');

  UPDATE app.ai_usage SET
    status = CASE WHEN v_seconds > 0 OR v_cost > 0 THEN 'SETTLED'::app.ai_usage_status ELSE 'RELEASED'::app.ai_usage_status END,
    units = greatest(v_seconds, 1), input_tokens = least(v_in, 2147483647)::int, output_tokens = least(v_out, 2147483647)::int,
    cache_read_tokens = least(v_cached, 2147483647)::int, cost_micros = ceil(v_cost)::bigint, cost_estimated = v_estimated,
    outcome = CASE WHEN v_seconds > 0 OR v_cost > 0 THEN 'ANSWERED' WHEN p_reason = 'PROVIDER_ERROR' THEN 'PROVIDER_ERROR' END,
    settled_at = clock_timestamp()
  WHERE id = v_use.id;
  UPDATE app.ai_voice_sessions SET status = 'ENDED', ended_at = clock_timestamp(), used_seconds = v_seconds, usage = u, end_reason = p_reason, ticket_hash = NULL
  WHERE id = p_session;
  IF v_cost > 0 THEN PERFORM app.ai_check_budget_alerts(v_use.plan_code); END IF;
END $$;

-- Settles sessions that were never opened (ticket expired) or whose stream went silent (no
-- heartbeat for 90 s, e.g. the server restarted). NULL = every person's.
CREATE FUNCTION app.ai_voice_reap(p_user text DEFAULT NULL) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v record;
  n int := 0;
BEGIN
  FOR v IN
    SELECT id, status, used_seconds, usage FROM app.ai_voice_sessions
    WHERE status <> 'ENDED' AND (p_user IS NULL OR user_id = p_user)
      AND ((status = 'PENDING' AND ticket_expires_at < clock_timestamp())
        OR (status = 'STREAMING' AND heartbeat_at < clock_timestamp() - interval '90 seconds'))
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM app.ai_voice_finish(v.id, v.used_seconds, v.usage, CASE WHEN v.status = 'PENDING' THEN 'EXPIRED' ELSE 'LOST' END);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

/*
 * Starts a voice session for the caller in one of their conversations: separate voice consent,
 * then every gate of ai_reserve (flag, route, assistant consent, eligible approved model, budgets,
 * weekly allowance, one live session per person), reserving the first block of up to 30 seconds.
 * The caller supplies only the hash of the ticket it will hand to the app.
 */
CREATE FUNCTION app.ai_voice_start(p_configured app.ai_provider[], p_language text, p_conversation uuid, p_ticket_hash text)
RETURNS TABLE (session_id uuid, provider app.ai_provider, model_id text, reserved_seconds int, weekly_limit int, used int, resets_at timestamptz, max_output_tokens int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_user text := app.current_user_id();
  v_limit int;
  v_used int;
  v_units int;
  v_res record;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501'; END IF;
  IF p_ticket_hash IS NULL OR p_ticket_hash !~ '^[0-9a-f]{64}$' OR p_language NOT IN ('ar', 'en') THEN RAISE EXCEPTION 'INVALID_ROUTING_HINT' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app.ai_conversations c WHERE c.id = p_conversation AND c.user_id = v_user) THEN
    RAISE EXCEPTION 'AI_CONVERSATION_INVALID' USING ERRCODE = 'P0001';
  END IF;
  PERFORM app.ai_voice_reap(v_user);
  SELECT q.weekly_limit INTO v_limit FROM app.ai_plan_quotas q WHERE q.plan_code = app.effective_plan(v_user) AND q.metric = 'VOICE_SECONDS';
  v_used := app.ai_used_units(v_user, 'VOICE_SECONDS', app.ai_week_start(now()));
  v_units := greatest(1, least(30, coalesce(v_limit, 0) - v_used));
  -- Feature flag, route, assistant consent, model, budget, allowance and concurrency (in that order).
  SELECT * INTO v_res FROM app.ai_reserve('patient.voice', v_units, p_configured, NULL, p_language) r;
  -- Voice consent is checked after the availability gates so the app can explain the right step.
  IF NOT app.has_current_consent('AI_VOICE_PROCESSING') THEN RAISE EXCEPTION 'AI_VOICE_CONSENT_REQUIRED' USING ERRCODE = '42501'; END IF;

  INSERT INTO app.ai_voice_sessions (user_id, conversation_id, usage_id, provider, model_id, locale, ticket_hash, ticket_expires_at)
  VALUES (v_user, p_conversation, v_res.reservation_id, (v_res.candidates -> 0 ->> 'provider')::app.ai_provider, v_res.candidates -> 0 ->> 'modelId',
          p_language, p_ticket_hash, clock_timestamp() + interval '60 seconds')
  RETURNING id INTO v_id;
  RETURN QUERY SELECT v_id, (v_res.candidates -> 0 ->> 'provider')::app.ai_provider, v_res.candidates -> 0 ->> 'modelId', v_units, v_res.weekly_limit, v_res.used, v_res.resets_at, v_res.max_output_tokens;
END $$;

/*
 * Opens the stream: the ticket (hash) must match a pending, unexpired session; it is single-use.
 * Called before any user context exists (the ticket is the credential).
 */
CREATE FUNCTION app.ai_voice_claim(p_session uuid, p_ticket_hash text)
RETURNS TABLE (user_id text, conversation_id uuid, provider app.ai_provider, model_id text, locale text, reserved_seconds int, max_output_tokens int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_s app.ai_voice_sessions;
  v_units int;
BEGIN
  SELECT * INTO v_s FROM app.ai_voice_sessions s WHERE s.id = p_session FOR UPDATE;
  IF NOT FOUND OR v_s.status <> 'PENDING' OR v_s.ticket_hash IS DISTINCT FROM p_ticket_hash OR v_s.ticket_expires_at < clock_timestamp() THEN
    RAISE EXCEPTION 'AI_VOICE_TICKET_INVALID' USING ERRCODE = '42501';
  END IF;
  IF NOT app.account_active(v_s.user_id) THEN RAISE EXCEPTION 'ACCOUNT_RESTRICTED' USING ERRCODE = '42501'; END IF;
  UPDATE app.ai_voice_sessions s SET status = 'STREAMING', ticket_hash = NULL, started_at = clock_timestamp(), heartbeat_at = clock_timestamp() WHERE s.id = p_session;
  SELECT u.units INTO v_units FROM app.ai_usage u WHERE u.id = v_s.usage_id;
  RETURN QUERY SELECT v_s.user_id, v_s.conversation_id, v_s.provider, v_s.model_id, v_s.locale, v_units,
    (SELECT r.max_output_tokens FROM app.ai_routes r WHERE r.key = 'patient.voice');
END $$;

/*
 * Heartbeat + next block: records progress (seconds, usage so far) and, if every gate still holds,
 * reserves up to 30 more seconds. Returns the new reserved total and, when nothing more is granted,
 * why (the stream must then end at the reserved total).
 */
CREATE FUNCTION app.ai_voice_extend(p_session uuid, p_used_seconds int, p_usage jsonb)
RETURNS TABLE (reserved_seconds int, stop_reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_s app.ai_voice_sessions;
  v_use app.ai_usage;
  v_route app.ai_routes;
  v_internal boolean;
  v_limit int;
  v_used int;
  v_grant int := 0;
  v_reason text;
  v_budget bigint;
  v_pb app.ai_plan_budgets;
BEGIN
  SELECT * INTO v_s FROM app.ai_voice_sessions s WHERE s.id = p_session AND s.user_id = app.current_user_id() FOR UPDATE;
  IF NOT FOUND OR v_s.status <> 'STREAMING' THEN RAISE EXCEPTION 'AI_VOICE_SESSION_INVALID' USING ERRCODE = 'P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_usage:' || v_s.user_id, 0));
  SELECT * INTO v_use FROM app.ai_usage u WHERE u.id = v_s.usage_id FOR UPDATE;
  SELECT * INTO v_route FROM app.ai_routes r WHERE r.key = 'patient.voice';
  v_internal := EXISTS (SELECT 1 FROM app.user_profiles p WHERE p.user_id = v_s.user_id AND p.account_kind = 'INTERNAL_TEST');

  v_reason := CASE
    WHEN NOT app.account_active(v_s.user_id) THEN 'STOPPED'
    WHEN NOT v_route.enabled OR (NOT (SELECT f.enabled FROM app.feature_flags f WHERE f.key = v_route.feature_flag) AND NOT v_internal) THEN 'STOPPED'
    WHEN NOT app.has_current_consent('AI_ASSISTANT_PROCESSING') OR NOT app.has_current_consent('AI_VOICE_PROCESSING') THEN 'STOPPED'
    WHEN clock_timestamp() - v_s.started_at > interval '10 minutes' THEN 'MAX_DURATION'
  END;
  IF v_reason IS NULL AND v_s.provider <> 'SIMULATED' THEN
    SELECT monthly_limit_micros INTO v_budget FROM app.ai_budget;
    SELECT * INTO v_pb FROM app.ai_plan_budgets b WHERE b.plan_code = v_use.plan_code;
    IF v_budget IS NULL OR app.ai_month_spend() >= v_budget
       OR (v_pb.plan_monthly_limit_micros IS NOT NULL AND app.ai_month_spend_by(NULL, v_use.plan_code) >= v_pb.plan_monthly_limit_micros)
       OR (v_pb.user_monthly_limit_micros IS NOT NULL AND app.ai_month_spend_by(v_s.user_id, NULL) >= v_pb.user_monthly_limit_micros) THEN
      v_reason := 'STOPPED';
    END IF;
  END IF;
  IF v_reason IS NULL THEN
    SELECT q.weekly_limit INTO v_limit FROM app.ai_plan_quotas q WHERE q.plan_code = v_use.plan_code AND q.metric = 'VOICE_SECONDS';
    v_used := app.ai_used_units(v_s.user_id, 'VOICE_SECONDS', v_use.week_start); -- includes this session's reserved block
    v_grant := greatest(0, least(30, coalesce(v_limit, 0) - v_used, 600 - v_use.units));
    IF v_grant = 0 THEN v_reason := CASE WHEN v_use.units >= 600 THEN 'MAX_DURATION' ELSE 'QUOTA' END; END IF;
  END IF;

  UPDATE app.ai_usage u SET units = u.units + v_grant WHERE u.id = v_use.id;
  UPDATE app.ai_voice_sessions s SET heartbeat_at = clock_timestamp(),
    used_seconds = least(greatest(coalesce(p_used_seconds, 0), s.used_seconds), v_use.units + v_grant),
    usage = CASE WHEN jsonb_typeof(p_usage) = 'object' THEN p_usage ELSE s.usage END
  WHERE s.id = p_session;
  RETURN QUERY SELECT v_use.units + v_grant, v_reason;
END $$;

CREATE FUNCTION app.ai_voice_settle(p_session uuid, p_seconds int, p_usage jsonb, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.ai_voice_sessions s WHERE s.id = p_session AND s.user_id = app.current_user_id()) THEN
    RAISE EXCEPTION 'AI_VOICE_SESSION_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('USER_ENDED', 'QUOTA', 'MAX_DURATION', 'IDLE', 'DISCONNECTED', 'PROVIDER_ERROR', 'EMERGENCY', 'STOPPED', 'SERVER_SHUTDOWN') THEN
    RAISE EXCEPTION 'INVALID_END_REASON' USING ERRCODE = 'P0001';
  END IF;
  PERFORM app.ai_voice_finish(p_session, p_seconds, p_usage, p_reason);
END $$;

/*
 * Records one transcribed turn in the session's conversation (text only; never audio). The
 * person's words are 'user' MESSAGE; the assistant's are MESSAGE / SIMULATED / REFUSAL, or the
 * fixed EMERGENCY_GUIDANCE (no model involved). Returns NULL if the conversation was deleted.
 */
CREATE FUNCTION app.ai_voice_record(p_session uuid, p_role text, p_kind text, p_content text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_s app.ai_voice_sessions;
  v_msg uuid;
BEGIN
  SELECT * INTO v_s FROM app.ai_voice_sessions s WHERE s.id = p_session AND s.user_id = app.current_user_id();
  IF NOT FOUND OR v_s.status <> 'STREAMING' THEN RAISE EXCEPTION 'AI_VOICE_SESSION_INVALID' USING ERRCODE = 'P0001'; END IF;
  IF NOT ((p_role = 'user' AND p_kind = 'MESSAGE') OR (p_role = 'assistant' AND p_kind IN ('MESSAGE', 'SIMULATED', 'REFUSAL', 'EMERGENCY_GUIDANCE'))) THEN
    RAISE EXCEPTION 'INVALID_KIND' USING ERRCODE = 'P0001';
  END IF;
  IF v_s.conversation_id IS NULL OR p_content IS NULL OR length(btrim(p_content)) = 0 THEN RETURN NULL; END IF;
  INSERT INTO app.ai_messages (conversation_id, user_id, role, kind, channel, content, usage_id, provider, model_id)
  VALUES (v_s.conversation_id, v_s.user_id, p_role, p_kind, 'VOICE', left(p_content, 12000),
          CASE WHEN p_role = 'assistant' AND p_kind <> 'EMERGENCY_GUIDANCE' THEN v_s.usage_id END,
          CASE WHEN p_role = 'assistant' AND p_kind <> 'EMERGENCY_GUIDANCE' THEN v_s.provider END,
          CASE WHEN p_role = 'assistant' AND p_kind <> 'EMERGENCY_GUIDANCE' THEN v_s.model_id END)
  RETURNING id INTO v_msg;
  UPDATE app.ai_conversations SET updated_at = now(), title = CASE WHEN title = '' AND p_role = 'user' THEN left(p_content, 60) ELSE title END
  WHERE id = v_s.conversation_id;
  RETURN v_msg;
END $$;

REVOKE ALL ON FUNCTION app.ai_jnum(jsonb, text), app.ai_check_budget_alerts(app.plan_code), app.ai_voice_finish(uuid, int, jsonb, text),
  app.ai_voice_reap(text), app.ai_voice_start(app.ai_provider[], text, uuid, text), app.ai_voice_claim(uuid, text),
  app.ai_voice_extend(uuid, int, jsonb), app.ai_voice_settle(uuid, int, jsonb, text), app.ai_voice_record(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ai_voice_reap(text), app.ai_voice_start(app.ai_provider[], text, uuid, text), app.ai_voice_claim(uuid, text),
  app.ai_voice_extend(uuid, int, jsonb), app.ai_voice_settle(uuid, int, jsonb, text), app.ai_voice_record(uuid, text, text, text) TO ghayarly_app;
