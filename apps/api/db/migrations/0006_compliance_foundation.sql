-- 0006 — Store & healthcare compliance foundation.
--
--   1. Consent ledger (append-only): terms, privacy policy, explicit health-data processing,
--      marketing. Health-data processing consent is ENFORCED here, not only in the UI.
--   2. Server-side feature flags. High-risk clinical / AI features cannot be enabled without a
--      recorded regulatory-evidence reference (CHECK constraint).
--   3. Review / test account isolation: App Store / Google Play review accounts only ever see
--      synthetic catalogue data, and real users never see review data.
--   4. In-app account deletion (Apple 5.1.1(v), Google Play account-deletion policy): one
--      SECURITY DEFINER function that erases the caller's own personal data atomically and
--      records what was deleted and what had to be retained.

-- ------------------------------------------------------------------ 1. account kinds (review isolation)
CREATE TYPE app.account_kind AS ENUM ('STANDARD', 'REVIEW', 'INTERNAL_TEST');
ALTER TABLE app.user_profiles ADD COLUMN account_kind app.account_kind NOT NULL DEFAULT 'STANDARD';
-- account_kind is deliberately absent from the UPDATE column grant: only the owner (review seed
-- script) can create review accounts. Self-service inserts are pinned to STANDARD.
DROP POLICY user_profiles_insert ON app.user_profiles;
CREATE POLICY user_profiles_insert ON app.user_profiles FOR INSERT TO ghayarly_app
  WITH CHECK (user_id = app.current_user_id() AND is_demo = false AND account_kind = 'STANDARD');

CREATE FUNCTION app.is_review_account() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.user_profiles
    WHERE user_id = app.current_user_id() AND account_kind IN ('REVIEW', 'INTERNAL_TEST')
  )
$$;

-- Visibility of PERSON-linked catalogue rows (clinician profiles, their credentials, ledgers):
--   review/test accounts → synthetic rows only (reviewers never see or contact real clinicians);
--   everyone else        → real rows, plus synthetic rows only when DEMO_MODE is on.
-- The public catalogue (TetraSol products, nursing service types) contains no personal data, so
-- review accounts see the same approved catalogue as real users (App Review must review what users get).
CREATE FUNCTION app.catalog_visible(p_is_demo boolean) RETURNS boolean
LANGUAGE sql STABLE SET search_path = app, pg_temp AS $$
  SELECT CASE WHEN app.is_review_account() THEN p_is_demo ELSE (NOT p_is_demo OR app.demo_visible()) END
$$;

DROP POLICY patients_select ON app.patients;
CREATE POLICY patients_select ON app.patients FOR SELECT TO ghayarly_app
  USING (app.can_view_patient(id) AND (NOT is_demo OR app.demo_visible() OR app.is_review_account()));

DROP POLICY provider_profiles_select ON app.provider_profiles;
CREATE POLICY provider_profiles_select ON app.provider_profiles FOR SELECT TO ghayarly_app
  USING (
    user_id = app.current_user_id()
    OR (verification_status = 'APPROVED' AND app.catalog_visible(is_demo))
    OR app.has_permission('provider.verification.review')
  );

CREATE OR REPLACE VIEW app.public_provider_credentials WITH (security_barrier = true) AS
  SELECT c.provider_user_id, c.kind, c.issuer, c.reviewed_at AS verified_at
  FROM app.provider_credentials c
  JOIN app.provider_profiles p ON p.user_id = c.provider_user_id
  WHERE c.status = 'APPROVED' AND p.verification_status = 'APPROVED' AND app.catalog_visible(p.is_demo);

DROP POLICY nursing_services_select ON app.nursing_services;
CREATE POLICY nursing_services_select ON app.nursing_services FOR SELECT TO ghayarly_app
  USING ((active AND (NOT is_demo OR app.demo_visible() OR app.is_review_account())) OR app.has_permission('catalog.services.manage'));

CREATE OR REPLACE FUNCTION app.product_visible(p_product uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.products
    WHERE id = p_product
      AND ((content_status = 'APPROVED' AND NOT is_demo) OR (is_demo AND (app.demo_visible() OR app.is_review_account())))
  )
$$;

DROP POLICY provider_ledger_select ON app.provider_ledger_entries;
CREATE POLICY provider_ledger_select ON app.provider_ledger_entries FOR SELECT TO ghayarly_app
  USING (provider_user_id = app.current_user_id() AND app.catalog_visible(is_demo));

-- ------------------------------------------------------------------ 2. consent ledger
CREATE TYPE app.consent_type AS ENUM ('TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'HEALTH_DATA_PROCESSING', 'MARKETING_COMMUNICATIONS');

CREATE TABLE app.consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES auth."user" ("id"),
  consent_type app.consent_type NOT NULL,
  document_version text NOT NULL CHECK (document_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  granted boolean NOT NULL,
  source text NOT NULL CHECK (source IN ('ios', 'android', 'web', 'admin', 'seed')),
  locale app.locale NOT NULL DEFAULT 'ar',
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX consent_events_user_idx ON app.consent_events (user_id, consent_type, occurred_at DESC);
CREATE TRIGGER consent_events_append_only BEFORE UPDATE OR DELETE ON app.consent_events
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE FUNCTION app.consent_events_pin() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'ghayarly_app' THEN NEW.occurred_at := clock_timestamp(); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER consent_events_pin BEFORE INSERT ON app.consent_events FOR EACH ROW EXECUTE FUNCTION app.consent_events_pin();

ALTER TABLE app.consent_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY consent_events_select ON app.consent_events FOR SELECT TO ghayarly_app
  USING (user_id = app.current_user_id() OR app.has_permission('audit.read'));
CREATE POLICY consent_events_insert ON app.consent_events FOR INSERT TO ghayarly_app
  WITH CHECK (user_id = app.current_user_id() AND source IN ('ios', 'android', 'web'));
GRANT SELECT, INSERT ON app.consent_events TO ghayarly_app;

-- Current document versions. Changing a version requires every user to consent again.
INSERT INTO app.settings (key, value, description) VALUES
  ('consent.current_versions',
   '{"TERMS_OF_SERVICE": "2026-10-draft", "PRIVACY_POLICY": "2026-10-draft", "HEALTH_DATA_PROCESSING": "2026-10-draft", "MARKETING_COMMUNICATIONS": "2026-10-draft"}',
   'Versions of the legal documents users must accept. Drafts pending legal approval (docs/release/PRIVACY_AND_DATA_DISCLOSURES.md).');

CREATE FUNCTION app.has_current_consent(p_type app.consent_type) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce((
    SELECT e.granted AND e.document_version = (SELECT value ->> p_type::text FROM app.settings WHERE key = 'consent.current_versions')
    FROM app.consent_events e
    WHERE e.user_id = app.current_user_id() AND e.consent_type = p_type
    ORDER BY e.occurred_at DESC, e.id DESC
    LIMIT 1
  ), false)
$$;

-- How many family profiles the caller may manage. 0007 redefines this once plans exist.
CREATE FUNCTION app.family_profile_limit() RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce((SELECT (value #>> '{}')::int FROM app.settings WHERE key = 'family.max_managed_profiles'), 8)
$$;
REVOKE ALL ON FUNCTION app.family_profile_limit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.family_profile_limit() TO ghayarly_app;

-- Health data may only be created after explicit, current health-data-processing consent.
CREATE OR REPLACE FUNCTION app.create_patient_profile(
  p_display_name text, p_date_of_birth date, p_sex app.sex, p_relationship app.relationship,
  p_consent_basis app.consent_basis, p_statement_version text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_user text := app.current_user_id();
  v_id uuid;
  v_age int;
  v_level app.access_level;
  v_limit int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501'; END IF;
  IF NOT app.has_role('PATIENT') THEN RAISE EXCEPTION 'PATIENT_ROLE_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF NOT app.has_current_consent('HEALTH_DATA_PROCESSING') THEN RAISE EXCEPTION 'HEALTH_DATA_CONSENT_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF p_date_of_birth > current_date THEN RAISE EXCEPTION 'INVALID_DATE_OF_BIRTH' USING ERRCODE = 'P0001'; END IF;
  IF coalesce(length(trim(p_statement_version)), 0) = 0 THEN RAISE EXCEPTION 'CONSENT_STATEMENT_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  v_age := extract(year FROM age(current_date, p_date_of_birth))::int;
  -- Serialise profile creation per account: the self-profile check and the family-size limit are
  -- count-then-insert, so two concurrent requests could otherwise both pass them.
  PERFORM pg_advisory_xact_lock(hashtextextended('patient_profiles:' || v_user, 0));

  IF p_relationship = 'SELF' THEN
    IF p_consent_basis <> 'SELF' THEN RAISE EXCEPTION 'INVALID_CONSENT_BASIS' USING ERRCODE = 'P0001'; END IF;
    IF EXISTS (SELECT 1 FROM app.patient_access WHERE user_id = v_user AND relationship = 'SELF' AND status = 'ACTIVE') THEN
      RAISE EXCEPTION 'SELF_PROFILE_EXISTS' USING ERRCODE = '23505';
    END IF;
    v_level := 'OWNER';
  ELSIF v_age < 18 THEN
    IF p_consent_basis <> 'GUARDIAN_OF_MINOR' THEN RAISE EXCEPTION 'MINOR_REQUIRES_GUARDIAN_BASIS' USING ERRCODE = 'P0001'; END IF;
    v_level := 'GUARDIAN';
  ELSE
    IF p_consent_basis NOT IN ('ADULT_CONSENT_ATTESTED', 'LEGAL_AUTHORITY_ATTESTED') THEN
      RAISE EXCEPTION 'ADULT_REQUIRES_CONSENT_BASIS' USING ERRCODE = 'P0001';
    END IF;
    v_level := 'CAREGIVER';
  END IF;

  IF p_relationship <> 'SELF' THEN
    v_limit := app.family_profile_limit();
    IF (SELECT count(*) FROM app.patient_access WHERE user_id = v_user AND status = 'ACTIVE' AND relationship <> 'SELF') >= v_limit THEN
      RAISE EXCEPTION 'FAMILY_LIMIT_REACHED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO app.patients (display_name, date_of_birth, sex, created_by_user_id, linked_user_id)
  VALUES (trim(p_display_name), p_date_of_birth, p_sex, v_user, CASE WHEN p_relationship = 'SELF' THEN v_user END)
  RETURNING id INTO v_id;

  INSERT INTO app.patient_access (patient_id, user_id, relationship, access_level, consent_basis, consent_statement_version, granted_by_user_id)
  VALUES (v_id, v_user, p_relationship, v_level, p_consent_basis, p_statement_version, v_user);

  PERFORM app.write_audit('patient.profile.created', 'patient', v_id::text, v_id,
    jsonb_build_object('relationship', p_relationship, 'consentBasis', p_consent_basis, 'accessLevel', v_level,
                       'consentStatementVersion', p_statement_version));
  RETURN v_id;
END $$;

-- Editing a profile stores health-context data too (blood type, emergency contacts, location).
CREATE OR REPLACE FUNCTION app.patients_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  IF current_user = 'ghayarly_app' THEN
    IF NOT app.has_current_consent('HEALTH_DATA_PROCESSING') THEN
      RAISE EXCEPTION 'HEALTH_DATA_CONSENT_REQUIRED' USING ERRCODE = '42501';
    END IF;
    IF NEW.blood_type IS DISTINCT FROM OLD.blood_type THEN
      IF NEW.blood_type = 'UNKNOWN' THEN
        NEW.blood_type_provenance := NULL;
      ELSE
        NEW.blood_type_provenance := CASE WHEN NEW.linked_user_id = app.current_user_id()
          THEN 'PATIENT_REPORTED'::app.provenance ELSE 'CAREGIVER_REPORTED'::app.provenance END;
      END IF;
    END IF;
    IF NEW.date_of_birth > current_date THEN
      RAISE EXCEPTION 'INVALID_DATE_OF_BIRTH' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Changing the content of an existing entry also requires current consent; marking an entry as
-- entered-in-error (a correction that removes it from view) stays possible without it.
CREATE FUNCTION app.health_entries_update_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  IF current_user = 'ghayarly_app' AND (NEW.title, NEW.detail, NEW.note) IS DISTINCT FROM (OLD.title, OLD.detail, OLD.note)
     AND NOT app.has_current_consent('HEALTH_DATA_PROCESSING') THEN
    RAISE EXCEPTION 'HEALTH_DATA_CONSENT_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER health_entries_update_guard BEFORE UPDATE ON app.patient_health_entries
  FOR EACH ROW EXECUTE FUNCTION app.health_entries_update_guard();

CREATE OR REPLACE FUNCTION app.health_entries_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  IF current_user = 'ghayarly_app' THEN
    IF NOT app.has_current_consent('HEALTH_DATA_PROCESSING') THEN
      RAISE EXCEPTION 'HEALTH_DATA_CONSENT_REQUIRED' USING ERRCODE = '42501';
    END IF;
    IF NEW.provenance IN ('PATIENT_REPORTED', 'CAREGIVER_REPORTED') THEN
      NEW.provenance := CASE WHEN (SELECT linked_user_id FROM app.patients WHERE id = NEW.patient_id) = app.current_user_id()
        THEN 'PATIENT_REPORTED'::app.provenance ELSE 'CAREGIVER_REPORTED'::app.provenance END;
    END IF;
    NEW.status := 'ACTIVE';
    NEW.created_at := now();
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;

-- ------------------------------------------------------------------ 3. feature flags
CREATE TYPE app.feature_risk AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TABLE app.feature_flags (
  key text PRIMARY KEY CHECK (key ~ '^[a-z]+(\.[a-z_]+)+$'),
  enabled boolean NOT NULL DEFAULT false,
  risk app.feature_risk NOT NULL,
  requires_regulatory_evidence boolean NOT NULL DEFAULT false,
  evidence_ref text CHECK (evidence_ref IS NULL OR length(evidence_ref) BETWEEN 3 AND 300),
  description text NOT NULL,
  updated_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Deterministic guard: a regulated feature cannot be switched on without documented evidence.
  CONSTRAINT regulated_feature_needs_evidence CHECK (NOT enabled OR NOT requires_regulatory_evidence OR evidence_ref IS NOT NULL)
);
CREATE TRIGGER feature_flags_touch BEFORE UPDATE ON app.feature_flags FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- SECURITY INVOKER on purpose: the role checks below compare current_user (see 0003 guards).
CREATE FUNCTION app.feature_flags_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  IF current_user = 'ghayarly_app' AND (NEW.risk, NEW.requires_regulatory_evidence, NEW.key) IS DISTINCT FROM (OLD.risk, OLD.requires_regulatory_evidence, OLD.key) THEN
    RAISE EXCEPTION 'PROTECTED_FIELD' USING ERRCODE = '42501';
  END IF;
  IF current_user = 'ghayarly_app' THEN NEW.updated_by_user_id := app.current_user_id(); END IF;
  PERFORM app.write_audit('feature.flag.updated', 'feature_flag', NEW.key, NULL,
    jsonb_build_object('from', OLD.enabled, 'to', NEW.enabled, 'evidenceRef', NEW.evidence_ref));
  RETURN NEW;
END $$;
CREATE TRIGGER feature_flags_audit BEFORE UPDATE ON app.feature_flags FOR EACH ROW EXECUTE FUNCTION app.feature_flags_audit();

ALTER TABLE app.feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY feature_flags_select ON app.feature_flags FOR SELECT TO ghayarly_app USING (true);
CREATE POLICY feature_flags_update ON app.feature_flags FOR UPDATE TO ghayarly_app
  USING (app.has_role('ADMIN')) WITH CHECK (app.has_role('ADMIN'));
GRANT SELECT ON app.feature_flags TO ghayarly_app;
-- updated_by_user_id is set by the trigger only.
GRANT UPDATE (enabled, evidence_ref, updated_at) ON app.feature_flags TO ghayarly_app;

INSERT INTO app.feature_flags (key, enabled, risk, requires_regulatory_evidence, description) VALUES
  ('ai.assistant', false, 'HIGH', true, 'Conversational health assistant. Requires clinical-safety review, AI governance sign-off and regulatory assessment before enabling.'),
  ('ai.wound_assessment', false, 'HIGH', true, 'AI analysis of wound photos. Potential software-as-a-medical-device: requires regulatory clearance evidence.'),
  ('clinical.diagnostic_suggestions', false, 'HIGH', true, 'Any automated diagnostic or triage suggestion. Requires validation study and regulatory evidence.'),
  ('care.home_visit_booking', false, 'MEDIUM', true, 'Booking home visits by nurses/doctors. Requires confirmation of Ministry of Health licensing for the operating entity.'),
  ('care.video_consultation', false, 'MEDIUM', true, 'Remote consultations. Requires telemedicine licensing evidence.'),
  ('commerce.checkout', false, 'MEDIUM', false, 'Paid checkout for TetraSol physical products through the external payment gateway.'),
  ('billing.store_subscriptions', false, 'MEDIUM', false, 'Digital subscriptions through Apple In-App Purchase / Google Play Billing.');

-- ------------------------------------------------------------------ 4. account deletion
CREATE TYPE app.deletion_status AS ENUM ('COMPLETED', 'COMPLETED_WITH_RETENTION');
CREATE TABLE app.account_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Pseudonymous tombstone id; the identity row itself is scrubbed.
  user_id text NOT NULL UNIQUE REFERENCES auth."user" ("id"),
  method text NOT NULL CHECK (method IN ('IN_APP', 'SUPPORT')),
  status app.deletion_status NOT NULL,
  summary jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE app.account_deletions ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_deletions_select ON app.account_deletions FOR SELECT TO ghayarly_app
  USING (app.has_permission('audit.read'));
GRANT SELECT ON app.account_deletions TO ghayarly_app;
CREATE TRIGGER account_deletions_append_only BEFORE UPDATE OR DELETE ON app.account_deletions
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

/*
 * Deletes the CALLER's account. Re-authentication is enforced by the API before calling.
 *   - Health records the caller alone controls are deleted (profiles, baseline entries, grants).
 *   - Profiles that belong to someone else (claimed by another account, or co-managed) are kept
 *     for them; only the caller's access is removed.
 *   - Provider data is deleted, unless financial ledger entries exist: those are retained for
 *     legal/accounting obligations, the profile is suspended and hidden, and personal text scrubbed.
 *   - Sign-in credentials, sessions and 2FA secrets are deleted; the identity row becomes an
 *     anonymous tombstone so audit trails and retained records stay referentially intact.
 */
CREATE FUNCTION app.delete_my_account(p_method text DEFAULT 'IN_APP') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_user text := app.current_user_id();
  v_email text;
  v_phone text;
  v_deleted_patients int := 0;
  v_detached_patients int := 0;
  v_provider_deleted boolean := false;
  v_provider_retained boolean := false;
  v_summary jsonb;
  r record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501'; END IF;
  IF p_method NOT IN ('IN_APP', 'SUPPORT') THEN RAISE EXCEPTION 'INVALID_METHOD' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM app.account_deletions WHERE user_id = v_user) THEN
    RAISE EXCEPTION 'ACCOUNT_ALREADY_DELETED' USING ERRCODE = 'P0001';
  END IF;
  SELECT email, "phoneNumber" INTO v_email, v_phone FROM auth."user" WHERE id = v_user;

  -- Health records
  FOR r IN
    SELECT pa.patient_id, p.linked_user_id
    FROM app.patient_access pa JOIN app.patients p ON p.id = pa.patient_id
    WHERE pa.user_id = v_user AND pa.status = 'ACTIVE'
  LOOP
    IF (r.linked_user_id = v_user)
       OR (r.linked_user_id IS NULL AND NOT EXISTS (
             SELECT 1 FROM app.patient_access o WHERE o.patient_id = r.patient_id AND o.user_id <> v_user AND o.status = 'ACTIVE')) THEN
      DELETE FROM app.patients WHERE id = r.patient_id;
      v_deleted_patients := v_deleted_patients + 1;
    ELSE
      UPDATE app.patient_access SET status = 'REVOKED', revoked_at = now(), revoked_by_user_id = v_user
      WHERE patient_id = r.patient_id AND user_id = v_user;
      v_detached_patients := v_detached_patients + 1;
    END IF;
  END LOOP;
  -- Profiles the caller created and nobody else can reach any more (e.g. they left them earlier).
  WITH orphaned AS (
    DELETE FROM app.patients p
    WHERE p.created_by_user_id = v_user
      AND (p.linked_user_id IS NULL OR p.linked_user_id = v_user)
      AND NOT EXISTS (SELECT 1 FROM app.patient_access o WHERE o.patient_id = p.id AND o.user_id <> v_user AND o.status = 'ACTIVE')
    RETURNING 1)
  SELECT v_deleted_patients + count(*) INTO v_deleted_patients FROM orphaned;
  UPDATE app.patients SET linked_user_id = NULL WHERE linked_user_id = v_user;

  DELETE FROM app.cart_items WHERE user_id = v_user;

  -- Provider data
  IF EXISTS (SELECT 1 FROM app.provider_profiles WHERE user_id = v_user) THEN
    IF EXISTS (SELECT 1 FROM app.provider_ledger_entries WHERE provider_user_id = v_user) THEN
      UPDATE app.provider_profiles SET
        verification_status = 'SUSPENDED', verification_note = 'Account deleted by user',
        display_name_ar = 'حساب محذوف', display_name_en = 'Deleted account',
        bio_ar = NULL, bio_en = NULL, current_affiliation = NULL, previous_experience = NULL,
        skills = '{}', service_area = NULL, temporarily_unavailable = true,
        subspecialty = NULL, city = '-', fee_piasters = NULL
      WHERE user_id = v_user;
      -- Identity documents (national ID, licence numbers) are not needed to keep payout records.
      DELETE FROM app.provider_credentials WHERE provider_user_id = v_user;
      UPDATE app.provider_verification_events SET note = NULL WHERE provider_user_id = v_user AND note IS NOT NULL;
      DELETE FROM app.provider_working_hours WHERE provider_user_id = v_user;
      DELETE FROM app.provider_services WHERE provider_user_id = v_user;
      v_provider_retained := true;
    ELSE
      DELETE FROM app.provider_profiles WHERE user_id = v_user;
      v_provider_deleted := true;
    END IF;
  END IF;

  UPDATE app.user_roles SET revoked_at = now() WHERE user_id = v_user AND revoked_at IS NULL;
  UPDATE app.user_profiles SET display_name = 'Deleted account', assistant_name = NULL, active_role = NULL WHERE user_id = v_user;

  -- Identity: credentials, sessions, 2FA, pending verifications, then the anonymous tombstone.
  DELETE FROM auth."session" WHERE "userId" = v_user;
  DELETE FROM auth."account" WHERE "userId" = v_user;
  DELETE FROM auth."twoFactor" WHERE "userId" = v_user;
  -- Includes password-reset tokens (identifier 'reset-password:<token>', value = user id).
  DELETE FROM auth."verification" WHERE identifier IN (v_email, v_phone) OR identifier LIKE '%' || v_user || '%' OR value = v_user;
  UPDATE auth."user" SET
    name = 'Deleted account', email = 'deleted-' || id || '@deleted.invalid', "emailVerified" = false, image = NULL,
    "phoneNumber" = NULL, "phoneNumberVerified" = false, "twoFactorEnabled" = false, "updatedAt" = now()
  WHERE id = v_user;

  v_summary := jsonb_build_object(
    'deletedPatientProfiles', v_deleted_patients,
    'detachedSharedProfiles', v_detached_patients,
    'providerProfileDeleted', v_provider_deleted,
    'providerRecordsRetainedForLegalObligations', v_provider_retained,
    'credentialsAndSessionsDeleted', true,
    'auditTrailRetained', true,
    'consentHistoryRetained', true);
  INSERT INTO app.account_deletions (user_id, method, status, summary)
  VALUES (v_user, p_method, CASE WHEN v_provider_retained THEN 'COMPLETED_WITH_RETENTION'::app.deletion_status ELSE 'COMPLETED'::app.deletion_status END, v_summary);
  PERFORM app.write_audit('account.deletion.completed', 'user', v_user, NULL, v_summary);
  RETURN v_summary;
END $$;

REVOKE ALL ON FUNCTION app.is_review_account(), app.catalog_visible(boolean), app.has_current_consent(app.consent_type),
  app.delete_my_account(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_review_account(), app.catalog_visible(boolean), app.has_current_consent(app.consent_type),
  app.delete_my_account(text) TO ghayarly_app;
