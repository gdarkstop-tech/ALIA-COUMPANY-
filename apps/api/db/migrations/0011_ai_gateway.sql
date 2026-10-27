-- 0011 — AI Gateway foundation: providers, models with ADMIN-ENTERED prices, routes, weekly plan
-- quotas, atomic reservation / settlement, a monthly spending cap, and the patient assistant's
-- conversations.
--
-- Principles enforced here, not only in the API:
--   * Provider credentials never live in the database (backend secret manager / env only).
--   * An unpriced model cannot serve traffic; prices are entered and verified by an administrator
--     (the seeds below are reference values to verify, inactive until then).
--   * Nothing is spent without a monthly budget; usage is reserved before the provider call and
--     settled after it, so concurrent requests cannot exceed a weekly allowance.
--   * A person's allowance is charged only for an answer they received.
--   * Conversations are private to their author: no staff role can read them.
--   * The assistant is behind the HIGH-risk `ai.assistant` flag (regulatory evidence required to
--     enable) plus the person's explicit AI_ASSISTANT_PROCESSING consent; internal test accounts
--     can use it before launch.

CREATE TYPE app.ai_provider AS ENUM ('ANTHROPIC', 'OPENAI', 'GEMINI', 'SIMULATED');
CREATE TYPE app.ai_metric AS ENUM ('CHAT_MESSAGES', 'ANALYSES', 'VOICE_SECONDS');
CREATE TYPE app.ai_model_tier AS ENUM ('BASIC', 'ADVANCED', 'PREMIUM');
CREATE TYPE app.ai_usage_status AS ENUM ('RESERVED', 'SETTLED', 'RELEASED');

-- ------------------------------------------------------------------ models & prices
CREATE TABLE app.ai_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider app.ai_provider NOT NULL,
  model_id text NOT NULL CHECK (model_id ~ '^[A-Za-z0-9._:/-]{2,100}$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 2 AND 80),
  -- USD per 1,000,000 tokens, in micro-dollars (1 USD = 1,000,000). NULL = unknown.
  input_price_micros bigint CHECK (input_price_micros IS NULL OR input_price_micros >= 0),
  output_price_micros bigint CHECK (output_price_micros IS NULL OR output_price_micros >= 0),
  cache_read_price_micros bigint CHECK (cache_read_price_micros IS NULL OR cache_read_price_micros >= 0),
  price_source text CHECK (price_source IS NULL OR length(price_source) BETWEEN 3 AND 300),
  price_verified_at timestamptz,
  price_verified_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, model_id),
  CONSTRAINT active_model_is_priced CHECK (NOT active OR provider = 'SIMULATED'
    OR (input_price_micros IS NOT NULL AND output_price_micros IS NOT NULL AND price_verified_at IS NOT NULL))
);
CREATE TRIGGER ai_models_touch BEFORE UPDATE ON app.ai_models FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Reference prices from Anthropic's published API pricing (as cached for this build, 2026-10-06).
-- NOT verified: an administrator must confirm them against the live pricing page before a model
-- can be activated. Claude Haiku 5.5's price applies to prompts up to 100K tokens.
-- No OpenAI or Gemini models are seeded: their model IDs and prices must be entered by an
-- administrator from the providers' own pricing pages.
INSERT INTO app.ai_models (provider, model_id, display_name, input_price_micros, output_price_micros, cache_read_price_micros, price_source) VALUES
  ('ANTHROPIC', 'claude-opus-5-5', 'Claude Opus 5.5', 4000000, 20000000, 200000, 'Anthropic API pricing (reference cached 2026-10-06) — verify before activating'),
  ('ANTHROPIC', 'claude-sonnet-5-5', 'Claude Sonnet 5.5', 2000000, 10000000, 200000, 'Anthropic API pricing (reference cached 2026-10-06) — verify before activating'),
  ('ANTHROPIC', 'claude-haiku-5-5', 'Claude Haiku 5.5', 100000, 500000, NULL, 'Anthropic API pricing (reference cached 2026-10-06, prompts ≤ 100K tokens) — verify before activating');
-- Development / automated tests only (refused by the API in production): labelled, free, never a real answer.
INSERT INTO app.ai_models (provider, model_id, display_name, input_price_micros, output_price_micros, price_source, active) VALUES
  ('SIMULATED', 'simulated-echo', 'Simulated (development only)', 0, 0, 'Not a real provider', true);

-- ------------------------------------------------------------------ routes
CREATE TABLE app.ai_routes (
  key text PRIMARY KEY CHECK (key ~ '^[a-z]+(\.[a-z_]+)+$'),
  description text NOT NULL,
  feature_flag text NOT NULL REFERENCES app.feature_flags (key),
  metric app.ai_metric NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  max_output_tokens int NOT NULL DEFAULT 2048 CHECK (max_output_tokens BETWEEN 256 AND 32000),
  updated_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER ai_routes_touch BEFORE UPDATE ON app.ai_routes FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE app.ai_route_models (
  route_key text NOT NULL REFERENCES app.ai_routes (key) ON DELETE CASCADE,
  tier app.ai_model_tier NOT NULL,
  model uuid NOT NULL REFERENCES app.ai_models (id),
  -- Used when the primary provider fails (not for safety refusals, which are handled per provider).
  fallback_model uuid REFERENCES app.ai_models (id),
  effort text NOT NULL DEFAULT 'medium' CHECK (effort IN ('low', 'medium', 'high', 'xhigh', 'max')),
  PRIMARY KEY (route_key, tier),
  CONSTRAINT fallback_differs CHECK (fallback_model IS NULL OR fallback_model <> model)
);

INSERT INTO app.ai_routes (key, description, feature_flag, metric) VALUES
  ('patient.chat', 'Personal health assistant (text). General information only — never a diagnosis; emergencies are routed to 123.', 'ai.assistant', 'CHAT_MESSAGES');
-- Plan tiers differ by reasoning effort on the same model; administrators choose the models.
INSERT INTO app.ai_route_models (route_key, tier, model, effort)
SELECT 'patient.chat', t.tier, m.id, t.effort
FROM (VALUES ('BASIC'::app.ai_model_tier, 'low'), ('ADVANCED'::app.ai_model_tier, 'medium'), ('PREMIUM'::app.ai_model_tier, 'high')) AS t(tier, effort)
CROSS JOIN app.ai_models m WHERE m.provider = 'ANTHROPIC' AND m.model_id = 'claude-opus-5-5';

-- ------------------------------------------------------------------ weekly allowances
ALTER TABLE app.billing_plans ADD COLUMN ai_model_tier app.ai_model_tier NOT NULL DEFAULT 'BASIC';
UPDATE app.billing_plans SET ai_model_tier = CASE code WHEN 'GOLD' THEN 'ADVANCED'::app.ai_model_tier WHEN 'PLATINUM' THEN 'PREMIUM'::app.ai_model_tier ELSE 'BASIC'::app.ai_model_tier END;
GRANT UPDATE (ai_model_tier) ON app.billing_plans TO ghayarly_app;

CREATE TABLE app.ai_plan_quotas (
  plan_code app.plan_code NOT NULL,
  metric app.ai_metric NOT NULL,
  weekly_limit int NOT NULL CHECK (weekly_limit BETWEEN 0 AND 1000000),
  updated_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_code, metric)
);
INSERT INTO app.ai_plan_quotas (plan_code, metric, weekly_limit) VALUES
  ('SILVER', 'CHAT_MESSAGES', 50), ('SILVER', 'ANALYSES', 5), ('SILVER', 'VOICE_SECONDS', 180),
  ('GOLD', 'CHAT_MESSAGES', 150), ('GOLD', 'ANALYSES', 15), ('GOLD', 'VOICE_SECONDS', 1200),
  ('PLATINUM', 'CHAT_MESSAGES', 400), ('PLATINUM', 'ANALYSES', 35), ('PLATINUM', 'VOICE_SECONDS', 2700);

-- Clinician tools have their own policies (none enabled yet: 0 until an administrator sets them).
CREATE TABLE app.ai_role_quotas (
  role app.role NOT NULL CHECK (role IN ('DOCTOR', 'NURSE')),
  metric app.ai_metric NOT NULL,
  weekly_limit int NOT NULL CHECK (weekly_limit BETWEEN 0 AND 1000000),
  updated_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, metric)
);
INSERT INTO app.ai_role_quotas (role, metric, weekly_limit) VALUES
  ('DOCTOR', 'CHAT_MESSAGES', 0), ('DOCTOR', 'ANALYSES', 0), ('NURSE', 'CHAT_MESSAGES', 0), ('NURSE', 'ANALYSES', 0);

-- ------------------------------------------------------------------ monthly spending cap (single row)
CREATE TABLE app.ai_budget (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- NULL = no budget approved: the gateway spends nothing with a real provider.
  monthly_limit_micros bigint CHECK (monthly_limit_micros IS NULL OR monthly_limit_micros >= 0),
  updated_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app.ai_budget (id) VALUES (true);

-- ------------------------------------------------------------------ usage ledger (reserve → settle / release)
CREATE TABLE app.ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE,
  route_key text NOT NULL REFERENCES app.ai_routes (key),
  metric app.ai_metric NOT NULL,
  units int NOT NULL CHECK (units > 0),
  week_start timestamptz NOT NULL,
  status app.ai_usage_status NOT NULL DEFAULT 'RESERVED',
  tier app.ai_model_tier NOT NULL,
  provider app.ai_provider,
  model_id text,
  input_tokens int CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens int CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cache_read_tokens int CHECK (cache_read_tokens IS NULL OR cache_read_tokens >= 0),
  cost_micros bigint CHECK (cost_micros IS NULL OR cost_micros >= 0),
  -- True when the serving model had no verified price (e.g. a provider-side safety fallback model):
  -- the cost was estimated at the requested model's price.
  cost_estimated boolean NOT NULL DEFAULT false,
  outcome text CHECK (outcome IN ('ANSWERED', 'REFUSED', 'PROVIDER_ERROR', 'TRUNCATED')),
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  settled_at timestamptz
);
CREATE INDEX ai_usage_user_week_idx ON app.ai_usage (user_id, metric, week_start);
CREATE INDEX ai_usage_time_idx ON app.ai_usage (reserved_at);
ALTER TABLE app.ai_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_usage_select ON app.ai_usage FOR SELECT TO ghayarly_app
  USING (user_id = app.current_user_id() OR app.has_permission('ai.usage.read'));
GRANT SELECT ON app.ai_usage TO ghayarly_app;
-- No write grants: only the functions below write usage.

-- ------------------------------------------------------------------ conversations (private to their author)
CREATE TABLE app.ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE,
  route_key text NOT NULL REFERENCES app.ai_routes (key),
  -- Optional: the authorized patient profile whose summary the person chose to share as context.
  patient_id uuid REFERENCES app.patients (id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT '' CHECK (length(title) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_conversations_user_idx ON app.ai_conversations (user_id, updated_at DESC);
CREATE TRIGGER ai_conversations_touch BEFORE UPDATE ON app.ai_conversations FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
ALTER TABLE app.ai_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_conversations_own ON app.ai_conversations FOR ALL TO ghayarly_app
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id() AND (patient_id IS NULL OR app.can_view_patient(patient_id)));
GRANT SELECT, INSERT, DELETE ON app.ai_conversations TO ghayarly_app;
GRANT UPDATE (title, patient_id) ON app.ai_conversations TO ghayarly_app;

CREATE TABLE app.ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES app.ai_conversations (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  kind text NOT NULL DEFAULT 'MESSAGE' CHECK (kind IN ('MESSAGE', 'EMERGENCY_GUIDANCE', 'REFUSAL', 'SIMULATED')),
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 12000),
  usage_id uuid REFERENCES app.ai_usage (id) ON DELETE SET NULL,
  provider app.ai_provider,
  model_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ai_messages_conversation_idx ON app.ai_messages (conversation_id, created_at);
ALTER TABLE app.ai_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_messages_select ON app.ai_messages FOR SELECT TO ghayarly_app USING (user_id = app.current_user_id());
-- The app may write only the person's own words; assistant messages come from app.ai_settle().
CREATE POLICY ai_messages_insert ON app.ai_messages FOR INSERT TO ghayarly_app
  WITH CHECK (user_id = app.current_user_id() AND role = 'user' AND kind = 'MESSAGE' AND usage_id IS NULL AND provider IS NULL
              AND EXISTS (SELECT 1 FROM app.ai_conversations c WHERE c.id = conversation_id AND c.user_id = app.current_user_id()));
GRANT SELECT, INSERT ON app.ai_messages TO ghayarly_app;

-- Account deletion removes the person's conversations (usage rows keep only counts and costs).
CREATE FUNCTION app.ai_forget_deleted_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  DELETE FROM app.ai_conversations WHERE user_id = NEW.user_id;
  RETURN NEW;
END $$;
CREATE TRIGGER account_deletions_forget_ai AFTER INSERT ON app.account_deletions FOR EACH ROW EXECUTE FUNCTION app.ai_forget_deleted_account();

-- ------------------------------------------------------------------ configuration access & audit
ALTER TABLE app.ai_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_route_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_plan_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_role_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_budget ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_models_read ON app.ai_models FOR SELECT TO ghayarly_app USING (app.has_permission('ai.config.manage') OR app.has_permission('ai.usage.read'));
CREATE POLICY ai_models_write ON app.ai_models FOR ALL TO ghayarly_app USING (app.has_permission('ai.config.manage')) WITH CHECK (app.has_permission('ai.config.manage') AND provider <> 'SIMULATED');
CREATE POLICY ai_routes_read ON app.ai_routes FOR SELECT TO ghayarly_app USING (app.has_permission('ai.config.manage') OR app.has_permission('ai.usage.read'));
CREATE POLICY ai_routes_write ON app.ai_routes FOR UPDATE TO ghayarly_app USING (app.has_permission('ai.config.manage')) WITH CHECK (app.has_permission('ai.config.manage'));
CREATE POLICY ai_route_models_read ON app.ai_route_models FOR SELECT TO ghayarly_app USING (app.has_permission('ai.config.manage') OR app.has_permission('ai.usage.read'));
CREATE POLICY ai_route_models_write ON app.ai_route_models FOR UPDATE TO ghayarly_app USING (app.has_permission('ai.config.manage')) WITH CHECK (app.has_permission('ai.config.manage'));
CREATE POLICY ai_plan_quotas_read ON app.ai_plan_quotas FOR SELECT TO ghayarly_app USING (true);
CREATE POLICY ai_plan_quotas_write ON app.ai_plan_quotas FOR UPDATE TO ghayarly_app USING (app.has_permission('ai.config.manage')) WITH CHECK (app.has_permission('ai.config.manage'));
CREATE POLICY ai_role_quotas_read ON app.ai_role_quotas FOR SELECT TO ghayarly_app USING (true);
CREATE POLICY ai_role_quotas_write ON app.ai_role_quotas FOR UPDATE TO ghayarly_app USING (app.has_permission('ai.config.manage')) WITH CHECK (app.has_permission('ai.config.manage'));
CREATE POLICY ai_budget_read ON app.ai_budget FOR SELECT TO ghayarly_app USING (app.has_permission('ai.config.manage') OR app.has_permission('ai.usage.read'));
CREATE POLICY ai_budget_write ON app.ai_budget FOR UPDATE TO ghayarly_app USING (app.has_permission('ai.config.manage')) WITH CHECK (app.has_permission('ai.config.manage'));

GRANT SELECT ON app.ai_models, app.ai_routes, app.ai_route_models, app.ai_plan_quotas, app.ai_role_quotas, app.ai_budget TO ghayarly_app;
-- Whole-row INSERT (the ORM names every column); the trigger forces new models inactive and unverified.
GRANT INSERT ON app.ai_models TO ghayarly_app;
GRANT UPDATE (display_name, input_price_micros, output_price_micros, cache_read_price_micros, price_source, price_verified_at, active, updated_at) ON app.ai_models TO ghayarly_app;
GRANT UPDATE (enabled, max_output_tokens, updated_at) ON app.ai_routes TO ghayarly_app;
GRANT UPDATE (model, fallback_model, effort) ON app.ai_route_models TO ghayarly_app;
GRANT UPDATE (weekly_limit, updated_at) ON app.ai_plan_quotas, app.ai_role_quotas TO ghayarly_app;
GRANT UPDATE (monthly_limit_micros, updated_at) ON app.ai_budget TO ghayarly_app;

-- Invoker on purpose (current_user identifies the API role). Records who changed what; a price edit
-- clears its verification; activating needs a verified price (CHECK above).
CREATE FUNCTION app.ai_config_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE
  v_actor text := app.current_user_id();
BEGIN
  IF TG_TABLE_NAME = 'ai_models' THEN
    IF TG_OP = 'UPDATE' AND current_user = 'ghayarly_app' AND (NEW.input_price_micros, NEW.output_price_micros, NEW.cache_read_price_micros) IS DISTINCT FROM (OLD.input_price_micros, OLD.output_price_micros, OLD.cache_read_price_micros)
       AND NEW.price_verified_at IS NOT DISTINCT FROM OLD.price_verified_at THEN
      NEW.price_verified_at := NULL;
    END IF;
    IF TG_OP = 'UPDATE' AND current_user = 'ghayarly_app' AND NEW.price_verified_at IS DISTINCT FROM OLD.price_verified_at THEN
      NEW.price_verified_by_user_id := CASE WHEN NEW.price_verified_at IS NULL THEN NULL ELSE v_actor END;
      IF NEW.price_verified_at IS NOT NULL THEN NEW.price_verified_at := now(); END IF;
    END IF;
    IF TG_OP = 'INSERT' AND current_user = 'ghayarly_app' THEN NEW.active := false; NEW.price_verified_at := NULL; NEW.price_verified_by_user_id := NULL; END IF;
  ELSIF current_user = 'ghayarly_app' AND TG_TABLE_NAME IN ('ai_routes', 'ai_plan_quotas', 'ai_role_quotas', 'ai_budget') THEN
    NEW.updated_by_user_id := v_actor;
  END IF;
  IF current_user = 'ghayarly_app' THEN
    PERFORM app.write_audit('ai.config.' || TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, NULL, NULL,
      CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW)) ELSE jsonb_build_object('after', to_jsonb(NEW)) END);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_models_audit BEFORE INSERT OR UPDATE ON app.ai_models FOR EACH ROW EXECUTE FUNCTION app.ai_config_audit();
CREATE TRIGGER ai_routes_audit BEFORE UPDATE ON app.ai_routes FOR EACH ROW EXECUTE FUNCTION app.ai_config_audit();
CREATE TRIGGER ai_route_models_audit BEFORE UPDATE ON app.ai_route_models FOR EACH ROW EXECUTE FUNCTION app.ai_config_audit();
CREATE TRIGGER ai_plan_quotas_audit BEFORE UPDATE ON app.ai_plan_quotas FOR EACH ROW EXECUTE FUNCTION app.ai_config_audit();
CREATE TRIGGER ai_role_quotas_audit BEFORE UPDATE ON app.ai_role_quotas FOR EACH ROW EXECUTE FUNCTION app.ai_config_audit();
CREATE TRIGGER ai_budget_audit BEFORE UPDATE ON app.ai_budget FOR EACH ROW EXECUTE FUNCTION app.ai_config_audit();

-- ------------------------------------------------------------------ allowance, reservation, settlement
-- Allowances reset every Monday 00:00 Cairo time (7-day windows).
CREATE FUNCTION app.ai_week_start(p_at timestamptz) RETURNS timestamptz
LANGUAGE sql IMMUTABLE AS $$
  SELECT date_trunc('week', p_at AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo'
$$;

-- Reservations older than 10 minutes that were never settled (e.g. a crashed request) stop counting.
CREATE FUNCTION app.ai_used_units(p_user text, p_metric app.ai_metric, p_week timestamptz) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce(sum(units), 0)::int FROM app.ai_usage
  WHERE user_id = p_user AND metric = p_metric AND week_start = p_week
    AND (status = 'SETTLED' OR (status = 'RESERVED' AND reserved_at > clock_timestamp() - interval '10 minutes'))
$$;

CREATE FUNCTION app.ai_month_spend() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce(sum(cost_micros), 0)::bigint FROM app.ai_usage
  WHERE reserved_at >= date_trunc('month', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo'
$$;

-- The caller's allowance for a route (patients: their plan's weekly quota).
CREATE FUNCTION app.ai_allowance(p_route text)
RETURNS TABLE (metric app.ai_metric, weekly_limit int, used int, resets_at timestamptz, tier app.ai_model_tier, plan app.plan_code)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_user text := app.current_user_id();
  v_route app.ai_routes;
  v_plan app.plan_code;
  v_week timestamptz := app.ai_week_start(now());
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_route FROM app.ai_routes WHERE key = p_route;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_ROUTE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_plan := app.effective_plan(v_user);
  RETURN QUERY
    SELECT v_route.metric, q.weekly_limit, app.ai_used_units(v_user, v_route.metric, v_week), v_week + interval '7 days', p.ai_model_tier, v_plan
    FROM app.ai_plan_quotas q JOIN app.billing_plans p ON p.code = q.plan_code
    WHERE q.plan_code = v_plan AND q.metric = v_route.metric;
END $$;

/*
 * Reserves allowance for one request, atomically (serialised per person), after every gate:
 * signed in and active, route enabled, feature flag on (or an internal test account), current
 * AI consent, an active model, a monthly budget with headroom (real providers), and allowance
 * left this week. Returns what the gateway needs to call the provider. No credentials here.
 */
CREATE FUNCTION app.ai_reserve(p_route text, p_units int DEFAULT 1)
RETURNS TABLE (reservation_id uuid, provider app.ai_provider, model_id text, effort text, max_output_tokens int,
               fallback_provider app.ai_provider, fallback_model_id text, tier app.ai_model_tier, weekly_limit int, used int, resets_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_user text := app.current_user_id();
  v_route app.ai_routes;
  v_plan app.plan_code;
  v_tier app.ai_model_tier;
  v_limit int;
  v_used int;
  v_week timestamptz := app.ai_week_start(now());
  v_rm app.ai_route_models;
  v_model app.ai_models;
  v_fallback app.ai_models;
  v_budget bigint;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501'; END IF;
  IF NOT app.account_active(v_user) THEN RAISE EXCEPTION 'ACCOUNT_RESTRICTED' USING ERRCODE = '42501'; END IF;
  IF p_units IS NULL OR p_units < 1 OR p_units > 3600 THEN RAISE EXCEPTION 'INVALID_UNITS' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_route FROM app.ai_routes WHERE key = p_route;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_ROUTE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF NOT (SELECT enabled FROM app.feature_flags WHERE key = v_route.feature_flag) AND NOT EXISTS (
       SELECT 1 FROM app.user_profiles WHERE user_id = v_user AND account_kind = 'INTERNAL_TEST') THEN
    RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_route.enabled THEN RAISE EXCEPTION 'AI_ROUTE_DISABLED' USING ERRCODE = 'P0001'; END IF;
  IF NOT app.has_current_consent('AI_ASSISTANT_PROCESSING') THEN RAISE EXCEPTION 'AI_CONSENT_REQUIRED' USING ERRCODE = '42501'; END IF;

  v_plan := app.effective_plan(v_user);
  SELECT b.ai_model_tier INTO v_tier FROM app.billing_plans b WHERE b.code = v_plan;
  SELECT * INTO v_rm FROM app.ai_route_models WHERE route_key = p_route AND ai_route_models.tier = v_tier;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_ROUTE_NOT_CONFIGURED' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_model FROM app.ai_models WHERE id = v_rm.model;
  IF NOT v_model.active THEN RAISE EXCEPTION 'AI_MODEL_NOT_ACTIVE' USING ERRCODE = 'P0001'; END IF;
  IF v_rm.fallback_model IS NOT NULL THEN
    SELECT * INTO v_fallback FROM app.ai_models WHERE id = v_rm.fallback_model AND active;
  END IF;

  IF v_model.provider <> 'SIMULATED' THEN
    SELECT monthly_limit_micros INTO v_budget FROM app.ai_budget;
    IF v_budget IS NULL THEN RAISE EXCEPTION 'AI_BUDGET_NOT_SET' USING ERRCODE = 'P0001'; END IF;
    IF app.ai_month_spend() >= v_budget THEN RAISE EXCEPTION 'AI_BUDGET_EXHAUSTED' USING ERRCODE = 'P0001'; END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ai_usage:' || v_user || ':' || v_route.metric::text, 0));
  SELECT q.weekly_limit INTO v_limit FROM app.ai_plan_quotas q WHERE q.plan_code = v_plan AND q.metric = v_route.metric;
  v_used := app.ai_used_units(v_user, v_route.metric, v_week);
  IF coalesce(v_limit, 0) < v_used + p_units THEN RAISE EXCEPTION 'AI_QUOTA_EXCEEDED' USING ERRCODE = 'P0001'; END IF;

  INSERT INTO app.ai_usage (user_id, route_key, metric, units, week_start, tier, provider, model_id)
  VALUES (v_user, p_route, v_route.metric, p_units, v_week, v_tier, v_model.provider, v_model.model_id)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_model.provider, v_model.model_id, v_rm.effort, v_route.max_output_tokens,
    v_fallback.provider, v_fallback.model_id, v_tier, v_limit, v_used + p_units, v_week + interval '7 days';
END $$;

-- What the app needs to show the assistant's availability to the caller (no configuration details).
CREATE FUNCTION app.ai_route_status(p_route text)
RETURNS TABLE (feature_on boolean, internal_test boolean, consented boolean, route_on boolean, provider app.ai_provider, model_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT f.enabled,
         EXISTS (SELECT 1 FROM app.user_profiles p WHERE p.user_id = app.current_user_id() AND p.account_kind = 'INTERNAL_TEST'),
         app.has_current_consent('AI_ASSISTANT_PROCESSING'),
         r.enabled, m.provider, m.active
  FROM app.ai_routes r
  JOIN app.feature_flags f ON f.key = r.feature_flag
  LEFT JOIN app.billing_plans b ON b.code = app.effective_plan(app.current_user_id())
  LEFT JOIN app.ai_route_models rm ON rm.route_key = r.key AND rm.tier = b.ai_model_tier
  LEFT JOIN app.ai_models m ON m.id = rm.model
  WHERE r.key = p_route AND app.current_user_id() IS NOT NULL
$$;

-- Gives the allowance back when nothing was delivered (provider error before an answer).
CREATE FUNCTION app.ai_release(p_reservation uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  UPDATE app.ai_usage SET status = 'RELEASED', outcome = coalesce(outcome, 'PROVIDER_ERROR'), settled_at = clock_timestamp()
  WHERE id = p_reservation AND user_id = app.current_user_id() AND status = 'RESERVED';
END $$;

/*
 * Settles a reservation with what the provider actually reported and records the answer.
 * Cost comes from the SERVING model's verified price; if it has none (e.g. a provider-side safety
 * fallback), the requested model's price is used and the row is marked as estimated. Only an
 * ANSWERED outcome consumes allowance; refusals and errors are recorded but given back.
 */
CREATE FUNCTION app.ai_settle(
  p_reservation uuid, p_conversation uuid, p_provider app.ai_provider, p_served_model text,
  p_input_tokens int, p_output_tokens int, p_cache_read_tokens int, p_outcome text, p_kind text, p_content text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_use app.ai_usage;
  v_price app.ai_models;
  v_estimated boolean := false;
  v_cost bigint;
  v_msg uuid;
BEGIN
  SELECT * INTO v_use FROM app.ai_usage WHERE id = p_reservation AND user_id = app.current_user_id() FOR UPDATE;
  IF NOT FOUND OR v_use.status <> 'RESERVED' THEN RAISE EXCEPTION 'AI_RESERVATION_INVALID' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app.ai_conversations WHERE id = p_conversation AND user_id = v_use.user_id) THEN RAISE EXCEPTION 'AI_CONVERSATION_INVALID' USING ERRCODE = 'P0001'; END IF;
  IF p_outcome NOT IN ('ANSWERED', 'REFUSED', 'TRUNCATED') THEN RAISE EXCEPTION 'INVALID_OUTCOME' USING ERRCODE = 'P0001'; END IF;
  IF p_kind NOT IN ('MESSAGE', 'REFUSAL', 'SIMULATED') THEN RAISE EXCEPTION 'INVALID_KIND' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_price FROM app.ai_models WHERE provider = p_provider AND model_id = p_served_model AND (price_verified_at IS NOT NULL OR provider = 'SIMULATED');
  IF NOT FOUND THEN
    SELECT * INTO v_price FROM app.ai_models WHERE provider = v_use.provider AND model_id = v_use.model_id;
    v_estimated := true;
  END IF;
  v_cost := (coalesce(p_input_tokens, 0)::numeric * coalesce(v_price.input_price_micros, 0)
           + coalesce(p_output_tokens, 0)::numeric * coalesce(v_price.output_price_micros, 0)
           + coalesce(p_cache_read_tokens, 0)::numeric * coalesce(v_price.cache_read_price_micros, v_price.input_price_micros, 0)) / 1000000;

  UPDATE app.ai_usage SET
    status = CASE WHEN p_outcome IN ('ANSWERED', 'TRUNCATED') THEN 'SETTLED'::app.ai_usage_status ELSE 'RELEASED'::app.ai_usage_status END,
    provider = p_provider, model_id = p_served_model, input_tokens = p_input_tokens, output_tokens = p_output_tokens,
    cache_read_tokens = p_cache_read_tokens, cost_micros = ceil(v_cost)::bigint, cost_estimated = v_estimated,
    outcome = p_outcome, settled_at = clock_timestamp()
  WHERE id = p_reservation;

  INSERT INTO app.ai_messages (conversation_id, user_id, role, kind, content, usage_id, provider, model_id)
  VALUES (p_conversation, v_use.user_id, 'assistant', p_kind, p_content, p_reservation, p_provider, p_served_model)
  RETURNING id INTO v_msg;
  UPDATE app.ai_conversations SET updated_at = now() WHERE id = p_conversation;
  RETURN v_msg;
END $$;

-- Emergency guidance is deterministic (no provider, no allowance): recorded as an assistant message.
CREATE FUNCTION app.ai_record_emergency(p_conversation uuid, p_content text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_msg uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.ai_conversations WHERE id = p_conversation AND user_id = app.current_user_id()) THEN
    RAISE EXCEPTION 'AI_CONVERSATION_INVALID' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO app.ai_messages (conversation_id, user_id, role, kind, content)
  VALUES (p_conversation, app.current_user_id(), 'assistant', 'EMERGENCY_GUIDANCE', p_content) RETURNING id INTO v_msg;
  RETURN v_msg;
END $$;

REVOKE ALL ON FUNCTION app.ai_week_start(timestamptz), app.ai_used_units(text, app.ai_metric, timestamptz), app.ai_month_spend(),
  app.ai_allowance(text), app.ai_route_status(text), app.ai_reserve(text, int), app.ai_release(uuid),
  app.ai_settle(uuid, uuid, app.ai_provider, text, int, int, int, text, text, text), app.ai_record_emergency(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ai_week_start(timestamptz), app.ai_allowance(text), app.ai_route_status(text), app.ai_reserve(text, int), app.ai_release(uuid),
  app.ai_settle(uuid, uuid, app.ai_provider, text, int, int, int, text, text, text), app.ai_record_emergency(uuid, text) TO ghayarly_app;
-- Spend totals are for the AI control centre only.
CREATE FUNCTION app.ai_month_spend_for_staff() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT CASE WHEN app.has_permission('ai.usage.read') OR app.has_permission('ai.config.manage') THEN app.ai_month_spend() END
$$;
REVOKE ALL ON FUNCTION app.ai_month_spend_for_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ai_month_spend_for_staff() TO ghayarly_app;
