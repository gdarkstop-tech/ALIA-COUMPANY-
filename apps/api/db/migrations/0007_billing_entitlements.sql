-- 0007 — Subscription plans and server-verified entitlements.
--
-- Rules (docs/release/PAYMENT_COMPLIANCE.md):
--   * A client can NEVER grant itself access. Entitlement rows are written only by
--     app.billing_apply_event(), which the API calls after verifying a signed Apple transaction /
--     notification or an authoritative Google Play Developer API response.
--   * Every store event is recorded once (idempotent by source + event id) in an append-only log.
--   * Each user has a random app-account token. Purchases carry it (StoreKit appAccountToken /
--     Play obfuscatedExternalAccountId) so a signed transaction cannot be replayed onto another account.

CREATE TYPE app.plan_code AS ENUM ('SILVER', 'GOLD', 'PLATINUM');
CREATE TYPE app.payment_class AS ENUM ('PHYSICAL_PRODUCT', 'PHYSICAL_SERVICE', 'ELIGIBLE_PERSON_TO_PERSON_SERVICE', 'DIGITAL_SUBSCRIPTION', 'DIGITAL_FEATURE');
CREATE TYPE app.billing_period AS ENUM ('MONTHLY', 'YEARLY');
CREATE TYPE app.entitlement_source AS ENUM ('APPLE', 'GOOGLE', 'ADMIN_GRANT');
CREATE TYPE app.entitlement_status AS ENUM ('ACTIVE', 'GRACE_PERIOD', 'BILLING_RETRY', 'EXPIRED', 'REVOKED', 'REFUNDED');

-- ------------------------------------------------------------------ plans (admin-editable display + config)
CREATE TABLE app.billing_plans (
  code app.plan_code PRIMARY KEY,
  name_en text NOT NULL CHECK (length(name_en) BETWEEN 1 AND 40),
  name_ar text NOT NULL CHECK (length(name_ar) BETWEEN 1 AND 40),
  payment_class app.payment_class NOT NULL,
  benefits jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(benefits) = 'array'),
  family_profile_limit int CHECK (family_profile_limit IS NULL OR family_profile_limit BETWEEN 0 AND 20),
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  updated_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Paid plans unlock in-app features → they are digital subscriptions (store billing in the apps).
  CONSTRAINT paid_plans_are_digital CHECK (code = 'SILVER' OR payment_class = 'DIGITAL_SUBSCRIPTION')
);
CREATE TRIGGER billing_plans_touch BEFORE UPDATE ON app.billing_plans FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE app.billing_plan_offers (
  plan_code app.plan_code NOT NULL REFERENCES app.billing_plans (code) ON DELETE CASCADE,
  period app.billing_period NOT NULL,
  reference_price_piasters int NOT NULL CHECK (reference_price_piasters BETWEEN 0 AND 100000000),
  apple_product_id text UNIQUE CHECK (apple_product_id IS NULL OR apple_product_id ~ '^[A-Za-z0-9._-]{1,100}$'),
  google_product_id text CHECK (google_product_id IS NULL OR google_product_id ~ '^[a-z0-9._]{1,100}$'),
  google_base_plan_id text CHECK (google_base_plan_id IS NULL OR google_base_plan_id ~ '^[a-z0-9-]{1,63}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_code, period),
  UNIQUE (google_product_id, google_base_plan_id)
);
CREATE TRIGGER billing_plan_offers_touch BEFORE UPDATE ON app.billing_plan_offers FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE app.billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.billing_plan_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_plans_select ON app.billing_plans FOR SELECT TO ghayarly_app USING (active OR app.has_role('ADMIN'));
CREATE POLICY billing_plans_update ON app.billing_plans FOR UPDATE TO ghayarly_app USING (app.has_role('ADMIN')) WITH CHECK (app.has_role('ADMIN'));
CREATE POLICY billing_plan_offers_select ON app.billing_plan_offers FOR SELECT TO ghayarly_app USING (true);
CREATE POLICY billing_plan_offers_update ON app.billing_plan_offers FOR UPDATE TO ghayarly_app USING (app.has_role('ADMIN')) WITH CHECK (app.has_role('ADMIN'));
GRANT SELECT ON app.billing_plans, app.billing_plan_offers TO ghayarly_app;
GRANT UPDATE (name_en, name_ar, benefits, family_profile_limit, sort_order, active, updated_by_user_id, updated_at) ON app.billing_plans TO ghayarly_app;
GRANT UPDATE (reference_price_piasters, apple_product_id, google_product_id, google_base_plan_id, updated_at) ON app.billing_plan_offers TO ghayarly_app;

-- Spec §20 business prices (EGP). Store product ids stay NULL until created in App Store Connect /
-- Play Console (NEEDS_ACCOUNT_ACTION); without them nothing is purchasable.
INSERT INTO app.billing_plans (code, name_en, name_ar, payment_class, family_profile_limit, sort_order, benefits) VALUES
  ('SILVER', 'Silver', 'فضي', 'DIGITAL_SUBSCRIPTION', NULL, 1, '[
     {"key":"profile","en":"Personal health profile and medical record","ar":"ملف صحي وسجل طبي شخصي","kind":"DIGITAL"},
     {"key":"family","en":"Basic family support","ar":"دعم أساسي للعائلة","kind":"DIGITAL"},
     {"key":"discovery","en":"Find verified doctors and nurses","ar":"الوصول إلى أطباء وتمريض موثَّقين","kind":"DIGITAL"},
     {"key":"store","en":"TetraSol store","ar":"متجر TetraSol","kind":"DIGITAL"}]'),
  ('GOLD', 'Gold', 'ذهبي', 'DIGITAL_SUBSCRIPTION', 4, 2, '[
     {"key":"family","en":"You + up to 4 family profiles","ar":"أنت + حتى ٤ ملفات عائلية","kind":"DIGITAL"},
     {"key":"dashboard","en":"Enhanced family dashboard","ar":"لوحة عائلية مُحسّنة","kind":"DIGITAL"},
     {"key":"reminders","en":"Enhanced reminders and weekly health summary","ar":"تذكيرات مُحسّنة وملخص صحي أسبوعي","kind":"DIGITAL"},
     {"key":"priority","en":"Priority matching","ar":"أولوية في المطابقة","kind":"REAL_WORLD"},
     {"key":"fees","en":"Reduced eligible platform fees","ar":"رسوم منصة مخفّضة للخدمات المؤهلة","kind":"REAL_WORLD"},
     {"key":"support","en":"Priority support","ar":"دعم ذو أولوية","kind":"REAL_WORLD"}]'),
  ('PLATINUM', 'Platinum', 'بلاتيني', 'DIGITAL_SUBSCRIPTION', 8, 3, '[
     {"key":"family","en":"You + up to 8 family profiles","ar":"أنت + حتى ٨ ملفات عائلية","kind":"DIGITAL"},
     {"key":"management","en":"Premium family management and advanced summaries","ar":"إدارة عائلية متميزة وملخصات متقدمة","kind":"DIGITAL"},
     {"key":"priority","en":"Highest eligible matching priority","ar":"أعلى أولوية مطابقة متاحة","kind":"REAL_WORLD"},
     {"key":"booking","en":"Enhanced booking benefits","ar":"مزايا حجز مُحسّنة","kind":"REAL_WORLD"},
     {"key":"support","en":"Concierge-style support where staffed","ar":"دعم شخصي حيثما توفر فريق","kind":"REAL_WORLD"}]');
INSERT INTO app.billing_plan_offers (plan_code, period, reference_price_piasters) VALUES
  ('SILVER', 'MONTHLY', 0),
  ('GOLD', 'MONTHLY', 29900), ('GOLD', 'YEARLY', 299000),
  ('PLATINUM', 'MONTHLY', 69900), ('PLATINUM', 'YEARLY', 699000);

-- ------------------------------------------------------------------ per-user store account token
CREATE TABLE app.billing_accounts (
  user_id text PRIMARY KEY REFERENCES auth."user" ("id") ON DELETE CASCADE,
  app_account_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.billing_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_accounts_select ON app.billing_accounts FOR SELECT TO ghayarly_app USING (user_id = app.current_user_id());
CREATE POLICY billing_accounts_insert ON app.billing_accounts FOR INSERT TO ghayarly_app WITH CHECK (user_id = app.current_user_id());
GRANT SELECT ON app.billing_accounts TO ghayarly_app;
GRANT INSERT (user_id) ON app.billing_accounts TO ghayarly_app;

-- ------------------------------------------------------------------ entitlements (server-written only)
CREATE TABLE app.entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE,
  plan_code app.plan_code NOT NULL,
  source app.entitlement_source NOT NULL,
  status app.entitlement_status NOT NULL,
  product_id text,
  -- Apple originalTransactionId / Google purchaseToken (one subscription ↔ one account, forever).
  external_ref text,
  expires_at timestamptz,
  auto_renew boolean,
  last_event_at timestamptz NOT NULL,
  last_verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_ref),
  CONSTRAINT store_entitlement_has_ref CHECK (source = 'ADMIN_GRANT' OR external_ref IS NOT NULL),
  CONSTRAINT paid_plan_only CHECK (plan_code <> 'SILVER')
);
CREATE INDEX entitlements_user_idx ON app.entitlements (user_id);
ALTER TABLE app.entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY entitlements_select ON app.entitlements FOR SELECT TO ghayarly_app
  USING (user_id = app.current_user_id() OR app.has_permission('users.read'));
GRANT SELECT ON app.entitlements TO ghayarly_app;
-- No INSERT/UPDATE/DELETE grants: only app.billing_apply_event() writes here.

CREATE TABLE app.store_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source app.entitlement_source NOT NULL,
  external_event_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type ~ '^[A-Z_]{3,40}$'),
  external_ref text,
  user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  event_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  outcome text NOT NULL CHECK (outcome IN ('APPLIED', 'IGNORED_STALE', 'IGNORED_UNKNOWN_SUBSCRIPTION', 'IGNORED_NOT_SUBSCRIPTION')),
  -- Verified, non-sensitive summary only (never raw receipts or tokens).
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source, external_event_id)
);
CREATE TRIGGER store_events_append_only BEFORE UPDATE OR DELETE ON app.store_events FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
ALTER TABLE app.store_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY store_events_select ON app.store_events FOR SELECT TO ghayarly_app USING (app.has_permission('audit.read'));
GRANT SELECT ON app.store_events TO ghayarly_app;

/*
 * Applies ONE already-verified store event. Idempotent (duplicate event ids are no-ops) and
 * order-safe (an event older than the last applied one never moves the state backwards — except
 * terminal refund/revocation, which always win).
 *
 * p_user: the account that submitted a purchase (client verify call) — NULL for server
 * notifications, which must reference a subscription already bound to an account.
 */
CREATE FUNCTION app.billing_apply_event(
  p_source app.entitlement_source, p_event_id text, p_event_type text, p_event_at timestamptz,
  p_external_ref text, p_user text, p_plan app.plan_code, p_product_id text,
  p_status app.entitlement_status, p_expires_at timestamptz, p_auto_renew boolean, p_summary jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_existing app.entitlements;
  v_outcome text;
  v_user text;
BEGIN
  IF p_source = 'ADMIN_GRANT' THEN RAISE EXCEPTION 'USE_ADMIN_GRANT' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM app.store_events WHERE source = p_source AND external_event_id = p_event_id) THEN
    RETURN 'DUPLICATE';
  END IF;

  SELECT * INTO v_existing FROM app.entitlements WHERE source = p_source AND external_ref = p_external_ref FOR UPDATE;
  IF FOUND AND p_user IS NOT NULL AND v_existing.user_id <> p_user THEN
    -- A subscription is bound to the first account that verified it.
    RAISE EXCEPTION 'SUBSCRIPTION_BELONGS_TO_ANOTHER_ACCOUNT' USING ERRCODE = '42501';
  END IF;
  v_user := coalesce(v_existing.user_id, p_user);

  IF v_user IS NULL THEN
    v_outcome := 'IGNORED_UNKNOWN_SUBSCRIPTION';
  ELSIF FOUND AND p_event_at < v_existing.last_event_at AND p_status NOT IN ('REFUNDED', 'REVOKED') THEN
    v_outcome := 'IGNORED_STALE';
  ELSIF FOUND THEN
    UPDATE app.entitlements SET plan_code = p_plan, status = p_status, product_id = p_product_id, expires_at = p_expires_at,
      auto_renew = p_auto_renew, last_event_at = greatest(last_event_at, p_event_at), last_verified_at = now()
    WHERE id = v_existing.id;
    v_outcome := 'APPLIED';
  ELSE
    INSERT INTO app.entitlements (user_id, plan_code, source, status, product_id, external_ref, expires_at, auto_renew, last_event_at)
    VALUES (v_user, p_plan, p_source, p_status, p_product_id, p_external_ref, p_expires_at, p_auto_renew, p_event_at);
    v_outcome := 'APPLIED';
  END IF;

  INSERT INTO app.store_events (source, external_event_id, event_type, external_ref, user_id, event_at, outcome, summary)
  VALUES (p_source, p_event_id, p_event_type, p_external_ref, v_user, p_event_at, v_outcome, coalesce(p_summary, '{}'::jsonb));
  IF v_outcome = 'APPLIED' THEN
    INSERT INTO app.audit_log (actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (v_user, 'billing.entitlement.updated', 'entitlement', p_external_ref,
            jsonb_build_object('source', p_source, 'event', p_event_type, 'plan', p_plan, 'status', p_status, 'expiresAt', p_expires_at));
  END IF;
  RETURN v_outcome;
END $$;

-- Server notifications carry the purchase's account token; resolve it to the account (no RLS context).
CREATE FUNCTION app.billing_user_for_token(p_token text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT user_id FROM app.billing_accounts WHERE app_account_token::text = lower(p_token)
$$;

-- Sandbox / test purchases are honoured in production only for these accounts.
CREATE FUNCTION app.billing_is_test_account(p_user text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM app.user_profiles WHERE user_id = p_user AND account_kind IN ('REVIEW', 'INTERNAL_TEST'))
$$;

-- The plan that currently grants access (highest active tier), SILVER otherwise.
CREATE FUNCTION app.effective_plan(p_user text) RETURNS app.plan_code
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce((
    SELECT plan_code FROM app.entitlements
    WHERE user_id = p_user AND (p_user = app.current_user_id() OR app.has_permission('users.read'))
      AND status IN ('ACTIVE', 'GRACE_PERIOD') AND (expires_at IS NULL OR expires_at > now())
    ORDER BY CASE plan_code WHEN 'PLATINUM' THEN 3 WHEN 'GOLD' THEN 2 ELSE 1 END DESC
    LIMIT 1
  ), 'SILVER'::app.plan_code)
$$;

REVOKE ALL ON FUNCTION app.billing_apply_event(app.entitlement_source, text, text, timestamptz, text, text, app.plan_code, text, app.entitlement_status, timestamptz, boolean, jsonb),
  app.effective_plan(text), app.billing_user_for_token(text), app.billing_is_test_account(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.billing_apply_event(app.entitlement_source, text, text, timestamptz, text, text, app.plan_code, text, app.entitlement_status, timestamptz, boolean, jsonb),
  app.effective_plan(text), app.billing_user_for_token(text), app.billing_is_test_account(text) TO ghayarly_app;
