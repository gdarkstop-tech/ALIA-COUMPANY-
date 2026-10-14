-- 0002 — Domain types, request-context helpers, roles, profiles, settings, audit log.
--
-- Request context: the API sets transaction-local settings before any domain query:
--   SELECT set_config('app.user_id', <authenticated user id>, true),
--          set_config('app.demo_mode', 'on' | 'off', true);
-- Policies below derive roles/permissions from tables — never from client-provided values.

-- Functions created by the owner are not executable by PUBLIC unless granted explicitly.
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TYPE app.role AS ENUM ('PATIENT', 'DOCTOR', 'NURSE', 'ADMIN', 'CLINICAL_REVIEWER', 'SUPPORT', 'TRUST_AND_SAFETY', 'COMMERCE_MANAGER');
CREATE TYPE app.locale AS ENUM ('ar', 'en');
CREATE TYPE app.sex AS ENUM ('FEMALE', 'MALE', 'UNSPECIFIED');
CREATE TYPE app.gender AS ENUM ('FEMALE', 'MALE');
CREATE TYPE app.blood_type AS ENUM ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'UNKNOWN');
CREATE TYPE app.provenance AS ENUM ('PATIENT_REPORTED', 'CAREGIVER_REPORTED', 'PROFESSIONALLY_VERIFIED', 'IMPORTED_DOCUMENT');
CREATE TYPE app.governorate AS ENUM ('CAIRO', 'GIZA', 'ALEXANDRIA', 'QALYUBIA', 'SHARQIA', 'DAKAHLIA', 'RED_SEA', 'SOUTH_SINAI');

-- ------------------------------------------------------------------ context helpers
CREATE FUNCTION app.current_user_id() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')
$$;

CREATE FUNCTION app.demo_visible() RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT coalesce(current_setting('app.demo_mode', true), 'off') = 'on'
$$;

-- ------------------------------------------------------------------ roles
CREATE TABLE app.user_roles (
  user_id text NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE,
  role app.role NOT NULL,
  granted_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (user_id, role)
);

-- SECURITY DEFINER so policies can consult roles without recursive RLS evaluation.
-- search_path is pinned to prevent object-shadowing attacks.
CREATE FUNCTION app.has_role(p_role app.role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.user_roles
    WHERE user_id = app.current_user_id() AND role = p_role AND revoked_at IS NULL
  )
$$;

-- Mirrors ROLE_PERMISSIONS in packages/shared/src/roles.ts (consistency is asserted by tests).
CREATE FUNCTION app.role_has_permission(p_role app.role, p_permission text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE p_role
    WHEN 'ADMIN' THEN p_permission = ANY (ARRAY[
      'provider.verification.review', 'provider.verification.decide', 'provider.capacity.manage_any',
      'catalog.tetrasol.manage', 'catalog.services.manage', 'audit.read', 'users.read', 'users.roles.grant'])
    WHEN 'CLINICAL_REVIEWER' THEN p_permission = ANY (ARRAY['provider.verification.review', 'provider.verification.decide'])
    WHEN 'SUPPORT' THEN p_permission = ANY (ARRAY['users.read', 'provider.verification.review'])
    WHEN 'TRUST_AND_SAFETY' THEN p_permission = ANY (ARRAY['audit.read', 'safety.reports.read', 'users.read'])
    WHEN 'COMMERCE_MANAGER' THEN p_permission = ANY (ARRAY['catalog.tetrasol.manage'])
    ELSE false
  END
$$;

CREATE FUNCTION app.has_permission(p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.user_roles ur
    WHERE ur.user_id = app.current_user_id() AND ur.revoked_at IS NULL
      AND app.role_has_permission(ur.role, p_permission)
  )
$$;

ALTER TABLE app.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_roles_select ON app.user_roles FOR SELECT TO ghayarly_app
  USING (user_id = app.current_user_id() OR app.has_permission('users.read'));
-- Users may give themselves only the three primary experiences; internal roles need users.roles.grant.
CREATE POLICY user_roles_insert ON app.user_roles FOR INSERT TO ghayarly_app
  WITH CHECK (
    (user_id = app.current_user_id() AND granted_by_user_id = app.current_user_id()
      AND role IN ('PATIENT', 'DOCTOR', 'NURSE') AND revoked_at IS NULL)
    OR (app.has_permission('users.roles.grant') AND granted_by_user_id = app.current_user_id())
  );
CREATE POLICY user_roles_update ON app.user_roles FOR UPDATE TO ghayarly_app
  USING (app.has_permission('users.roles.grant'))
  WITH CHECK (app.has_permission('users.roles.grant'));
GRANT SELECT, INSERT ON app.user_roles TO ghayarly_app;
GRANT UPDATE (revoked_at, granted_by_user_id, granted_at) ON app.user_roles TO ghayarly_app;

-- ------------------------------------------------------------------ minimal visibility of auth users
ALTER TABLE auth."user" ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_user_all_for_auth_role ON auth."user" TO ghayarly_auth USING (true) WITH CHECK (true);
CREATE POLICY auth_user_app_read ON auth."user" FOR SELECT TO ghayarly_app
  USING ("id" = app.current_user_id() OR app.has_permission('users.read'));

-- ------------------------------------------------------------------ user profile (app-level preferences)
CREATE TABLE app.user_profiles (
  user_id text PRIMARY KEY REFERENCES auth."user" ("id") ON DELETE CASCADE,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  locale app.locale NOT NULL DEFAULT 'ar',
  active_role app.role,
  assistant_name text CHECK (assistant_name IS NULL OR length(assistant_name) BETWEEN 1 AND 40),
  onboarding_completed_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_profiles_select ON app.user_profiles FOR SELECT TO ghayarly_app
  USING (user_id = app.current_user_id() OR app.has_permission('users.read'));
CREATE POLICY user_profiles_insert ON app.user_profiles FOR INSERT TO ghayarly_app
  WITH CHECK (user_id = app.current_user_id() AND is_demo = false);
CREATE POLICY user_profiles_update ON app.user_profiles FOR UPDATE TO ghayarly_app
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
GRANT SELECT ON app.user_profiles TO ghayarly_app;
-- Table-level INSERT (the ORM lists every column, using DEFAULT for omitted ones); the policy
-- forbids self-flagging as demo and the trigger below pins server-controlled timestamps.
GRANT INSERT ON app.user_profiles TO ghayarly_app;
GRANT UPDATE (display_name, locale, active_role, assistant_name, onboarding_completed_at, updated_at) ON app.user_profiles TO ghayarly_app;

-- ------------------------------------------------------------------ platform settings (configurable rules)
CREATE TABLE app.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY settings_select ON app.settings FOR SELECT TO ghayarly_app USING (true);
CREATE POLICY settings_update ON app.settings FOR UPDATE TO ghayarly_app
  USING (app.has_role('ADMIN')) WITH CHECK (app.has_role('ADMIN'));
GRANT SELECT ON app.settings TO ghayarly_app;
GRANT UPDATE (value, updated_by_user_id, updated_at) ON app.settings TO ghayarly_app;

INSERT INTO app.settings (key, value, description) VALUES
  ('family.max_managed_profiles', '8', 'Maximum family profiles one account may manage (plan-specific limits arrive with subscriptions).'),
  ('commerce.brand', '"TetraSol"', 'The only brand the store may list.');

-- ------------------------------------------------------------------ audit log (append-only)
CREATE TABLE app.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  action text NOT NULL CHECK (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  entity_type text NOT NULL,
  entity_id text,
  patient_id uuid,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_log_occurred_idx ON app.audit_log (occurred_at DESC);
CREATE INDEX audit_log_entity_idx ON app.audit_log (entity_type, entity_id);
CREATE INDEX audit_log_patient_idx ON app.audit_log (patient_id) WHERE patient_id IS NOT NULL;

CREATE FUNCTION app.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON app.audit_log
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

ALTER TABLE app.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_insert ON app.audit_log FOR INSERT TO ghayarly_app
  WITH CHECK (actor_user_id = app.current_user_id());
CREATE POLICY audit_log_select ON app.audit_log FOR SELECT TO ghayarly_app
  USING (app.has_permission('audit.read'));
GRANT INSERT, SELECT ON app.audit_log TO ghayarly_app;

-- Internal writer used by SECURITY DEFINER functions/triggers.
CREATE FUNCTION app.write_audit(p_action text, p_entity_type text, p_entity_id text, p_patient_id uuid, p_metadata jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = app, pg_temp AS $$
  INSERT INTO app.audit_log (actor_user_id, action, entity_type, entity_id, patient_id, metadata)
  VALUES (app.current_user_id(), p_action, p_entity_type, p_entity_id, p_patient_id, coalesce(p_metadata, '{}'::jsonb))
$$;
REVOKE ALL ON FUNCTION app.write_audit(text, text, text, uuid, jsonb) FROM PUBLIC;

-- Generic updated_at maintenance.
CREATE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER user_profiles_touch BEFORE UPDATE ON app.user_profiles FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Pins created_at/updated_at on INSERT for the application role.
CREATE FUNCTION app.pin_insert_timestamps() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'ghayarly_app' THEN
    NEW.created_at := now();
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_profiles_pin_ts BEFORE INSERT ON app.user_profiles FOR EACH ROW EXECUTE FUNCTION app.pin_insert_timestamps();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_user_id(), app.demo_visible(), app.has_role(app.role),
  app.has_permission(text), app.role_has_permission(app.role, text) TO ghayarly_app;
