-- 0027 — Dress My Wound Wound Intelligence Registry (ADR 0015).
--
--   1. Three separate permissions per patient profile, recorded in an append-only ledger:
--        A SCAN          — store wound photos and track healing (required for the feature, nothing else);
--        B RESEARCH      — optional, OFF by default: named purposes and named receiving entities;
--        C PRESENTATION  — optional, OFF by default: named audiences and organisations, and even then
--                          every case needs its own approval of the exact photos and text.
--      B and C can be given only by the adult themself or a caregiver with attested legal authority —
--      never for a minor in this version. Withdrawing stops future use at once (enforced here).
--   2. Clinical Wound Vault: cases, photos (binaries in encrypted object storage, never in rows),
--      observations and treatments. Photo access follows the profile's family access and live
--      clinician shares; every link to a photo is audited. Classification and outcome are written
--      only by a clinician with an active share — never inferred from a photo.
--   3. Research registry, separate from the vault: de-identified snapshots (no names, IDs, free text
--      or dates — day numbers only), keyed pseudonyms, the re-identification link in a table nobody
--      can read, clinical quality review, frozen versions with an approval reference and retention.
--   4. Presentation case library: nominate → prepare (exact photos, captions, audience, scope) →
--      the patient approves that exact version → a second approver signs the de-identification
--      checklist → export (disabled until approvals) of only the approved version.
--   5. Similar-case foundation, TetraSol product-outcome analytics (descriptive, small cells
--      suppressed) and the admin registry overview (counts only — no admin image access).
--   Every flag is OFF and regulated. With a flag off, INTERNAL_TEST accounts can exercise the
--   feature on test data only; test and real data never meet.

-- ------------------------------------------------------------------ roles and permissions
CREATE OR REPLACE FUNCTION app.role_has_permission(p_role app.role, p_permission text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE p_role
    WHEN 'ADMIN' THEN p_permission = ANY (ARRAY[
      'provider.verification.review', 'provider.verification.decide', 'provider.capacity.manage_any',
      'catalog.tetrasol.manage', 'catalog.services.manage', 'audit.read', 'users.read', 'users.roles.grant',
      'catalog.content.approve', 'catalog.brands.manage', 'users.status.manage', 'users.appeals.decide',
      'ai.config.manage', 'ai.usage.read', 'ai.eval.manage', 'ai.data.approve', 'knowledge.manage',
      'wound.registry.read'])
    WHEN 'CLINICAL_REVIEWER' THEN p_permission = ANY (ARRAY['provider.verification.review', 'provider.verification.decide', 'catalog.content.approve', 'ai.clinical.review', 'ai.safety.review', 'knowledge.manage',
      'wound.registry.read', 'wound.research.review'])
    WHEN 'SUPPORT' THEN p_permission = ANY (ARRAY['users.read', 'provider.verification.review'])
    WHEN 'TRUST_AND_SAFETY' THEN p_permission = ANY (ARRAY['audit.read', 'safety.reports.read', 'users.read', 'users.status.manage', 'users.appeals.decide', 'ai.safety.review'])
    WHEN 'COMMERCE_MANAGER' THEN p_permission = ANY (ARRAY['catalog.tetrasol.manage'])
    WHEN 'WOUND_RESEARCHER' THEN p_permission = ANY (ARRAY['wound.registry.read', 'wound.research.access'])
    WHEN 'PRESENTATION_APPROVER' THEN p_permission = ANY (ARRAY['wound.registry.read', 'wound.presentation.manage'])
    ELSE false
  END
$$;

-- The wound roles cannot be given to oneself (an administrator cannot open research data to themself).
CREATE FUNCTION app.user_roles_wound_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  IF current_user = 'ghayarly_app' AND NEW.role IN ('WOUND_RESEARCHER', 'PRESENTATION_APPROVER', 'CLINICAL_REVIEWER')
     AND NEW.user_id = app.current_user_id() THEN
    RAISE EXCEPTION 'SELF_GRANT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_roles_wound_guard BEFORE INSERT OR UPDATE ON app.user_roles FOR EACH ROW EXECUTE FUNCTION app.user_roles_wound_guard();

-- Staff-role list used by account-status changes (the two new roles are staff).
CREATE OR REPLACE FUNCTION app.set_account_status(
  p_user text, p_action app.status_action, p_reason app.status_reason, p_public_message text,
  p_staff_note text, p_suspended_until timestamptz, p_care_continuity_note text
) RETURNS app.account_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_actor text := app.current_user_id();
  v_cur app.account_states;
  v_from app.account_status;
  v_to app.account_status;
  v_restricted boolean;
  v_is_clinician boolean;
  v_is_staff boolean;
BEGIN
  IF NOT app.has_permission('users.status.manage') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF p_action = 'APPEAL_GRANTED' THEN RAISE EXCEPTION 'USE_DECIDE_APPEAL' USING ERRCODE = 'P0001'; END IF;
  IF p_user IS NULL OR p_user = v_actor THEN RAISE EXCEPTION 'SELF_ACTION_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth."user" WHERE id = p_user) THEN RAISE EXCEPTION 'USER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM app.account_deletions WHERE user_id = p_user) THEN RAISE EXCEPTION 'ACCOUNT_DELETED' USING ERRCODE = 'P0001'; END IF;
  IF coalesce(length(trim(p_staff_note)), 0) < 10 THEN RAISE EXCEPTION 'STAFF_NOTE_REQUIRED' USING ERRCODE = 'P0001'; END IF;

  SELECT EXISTS (SELECT 1 FROM app.user_roles WHERE user_id = p_user AND revoked_at IS NULL AND role IN ('DOCTOR', 'NURSE')) INTO v_is_clinician;
  SELECT EXISTS (SELECT 1 FROM app.user_roles WHERE user_id = p_user AND revoked_at IS NULL AND role IN ('ADMIN', 'CLINICAL_REVIEWER', 'SUPPORT', 'TRUST_AND_SAFETY', 'COMMERCE_MANAGER', 'WOUND_RESEARCHER', 'PRESENTATION_APPROVER')) INTO v_is_staff;
  IF v_is_staff AND NOT app.has_role('ADMIN') THEN RAISE EXCEPTION 'STAFF_TARGET_REQUIRES_ADMIN' USING ERRCODE = '42501'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('account_status:' || p_user, 0));
  SELECT * INTO v_cur FROM app.account_states WHERE user_id = p_user FOR UPDATE;
  v_from := app.account_status_of(p_user);
  v_restricted := coalesce(v_cur.bookings_restricted, false);
  v_to := v_from;

  CASE p_action
    WHEN 'SUSPEND' THEN
      IF p_reason IN ('RESOLVED', 'APPEAL_GRANTED') THEN RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001'; END IF;
      IF coalesce(length(trim(p_public_message)), 0) = 0 THEN RAISE EXCEPTION 'PUBLIC_MESSAGE_REQUIRED' USING ERRCODE = 'P0001'; END IF;
      IF p_suspended_until IS NOT NULL AND p_suspended_until <= now() THEN RAISE EXCEPTION 'INVALID_SUSPENSION_END' USING ERRCODE = 'P0001'; END IF;
      v_to := 'SUSPENDED';
    WHEN 'BLOCK' THEN
      IF p_reason IN ('RESOLVED', 'APPEAL_GRANTED') THEN RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001'; END IF;
      IF coalesce(length(trim(p_public_message)), 0) = 0 THEN RAISE EXCEPTION 'PUBLIC_MESSAGE_REQUIRED' USING ERRCODE = 'P0001'; END IF;
      v_to := 'BLOCKED';
    WHEN 'REACTIVATE' THEN
      IF v_from = 'ACTIVE' THEN RAISE EXCEPTION 'ALREADY_ACTIVE' USING ERRCODE = 'P0001'; END IF;
      v_to := 'ACTIVE';
    WHEN 'RESTRICT_BOOKINGS' THEN
      IF NOT v_is_clinician THEN RAISE EXCEPTION 'NOT_A_CLINICIAN' USING ERRCODE = 'P0001'; END IF;
      IF p_reason IN ('RESOLVED', 'APPEAL_GRANTED') THEN RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001'; END IF;
      v_restricted := true;
    WHEN 'LIFT_BOOKING_RESTRICTION' THEN
      IF NOT v_restricted THEN RAISE EXCEPTION 'NOT_RESTRICTED' USING ERRCODE = 'P0001'; END IF;
      v_restricted := false;
  END CASE;

  -- A clinician is never taken out of service silently: their current patients' continuity of care
  -- must be documented. (No booking module exists yet, so there are no bookings to reassign; when
  -- it lands, open bookings must be listed and handed over here.)
  IF v_is_clinician AND p_action IN ('SUSPEND', 'BLOCK', 'RESTRICT_BOOKINGS') AND coalesce(length(trim(p_care_continuity_note)), 0) < 10 THEN
    RAISE EXCEPTION 'CARE_CONTINUITY_NOTE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO app.account_states (user_id, status, bookings_restricted, reason, public_message, suspended_until, updated_by_user_id, updated_at)
  VALUES (p_user, v_to, v_restricted,
          CASE WHEN v_to = 'ACTIVE' AND NOT v_restricted THEN NULL ELSE p_reason END,
          CASE WHEN v_to = 'ACTIVE' AND NOT v_restricted THEN NULL ELSE nullif(trim(p_public_message), '') END,
          CASE WHEN v_to = 'SUSPENDED' THEN p_suspended_until END, v_actor, now())
  ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status, bookings_restricted = EXCLUDED.bookings_restricted, reason = EXCLUDED.reason,
    public_message = EXCLUDED.public_message, suspended_until = EXCLUDED.suspended_until, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now();

  INSERT INTO app.account_status_events (user_id, action, from_status, to_status, bookings_restricted, reason, public_message, staff_note, care_continuity_note, suspended_until, actor_user_id)
  VALUES (p_user, p_action, v_from, v_to, v_restricted, p_reason, nullif(trim(p_public_message), ''), trim(p_staff_note), nullif(trim(p_care_continuity_note), ''),
          CASE WHEN v_to = 'SUSPENDED' THEN p_suspended_until END, v_actor);

  -- Out everywhere, immediately: existing sessions stop working.
  IF v_to IN ('SUSPENDED', 'BLOCKED') THEN DELETE FROM auth."session" WHERE "userId" = p_user; END IF;

  PERFORM app.write_audit('users.status.' || lower(p_action::text), 'user', p_user, NULL,
    jsonb_build_object('from', v_from, 'to', v_to, 'bookingsRestricted', v_restricted, 'reason', p_reason, 'until', p_suspended_until));
  RETURN v_to;
END $$;

-- ------------------------------------------------------------------ clinician access to wounds
-- A record share does not include wound photos unless the person turns that on for that share:
-- shares made before this feature existed never widen silently.
ALTER TABLE app.care_shares ADD COLUMN wounds_allowed boolean NOT NULL DEFAULT false;
CREATE FUNCTION app.has_care_wound_access(p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT app.has_care_access(p_patient) AND EXISTS (
    SELECT 1 FROM app.care_shares s WHERE s.patient_id = p_patient AND s.provider_user_id = app.current_user_id() AND s.status = 'ACTIVE' AND s.wounds_allowed)
$$;
CREATE FUNCTION app.care_share_set_wounds(p_share uuid, p_allowed boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.care_shares;
BEGIN
  SELECT * INTO v FROM app.care_shares WHERE id = p_share FOR UPDATE;
  IF NOT FOUND OR NOT app.can_administer_patient(v.patient_id) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v.status <> 'ACTIVE' THEN RAISE EXCEPTION 'SHARE_NOT_ACTIVE' USING ERRCODE = 'P0001'; END IF;
  IF p_allowed AND NOT app.wound_consent_active(v.patient_id, 'SCAN') THEN RAISE EXCEPTION 'WOUND_SCAN_CONSENT_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  UPDATE app.care_shares SET wounds_allowed = p_allowed WHERE id = p_share;
  PERFORM app.write_audit('care.share.wounds', 'care_share', p_share::text, v.patient_id, jsonb_build_object('allowed', p_allowed));
END $$;

-- ------------------------------------------------------------------ flags
INSERT INTO app.feature_flags (key, enabled, risk, requires_regulatory_evidence, description) VALUES
  ('wound.registry', false, 'HIGH', true, 'Wound photo vault, timeline and wound-data permissions for patients. Needs the Egyptian Arabic / English permission wording approved by legal, the storage provider, region and contract approved, and a data-protection impact assessment.'),
  ('wound.research', false, 'HIGH', true, 'Consented wound research registry (datasets, clinical quality review, researcher access). Needs a research / ethics approval reference, legal approval of the research permission and a data-protection assessment.'),
  ('wound.research_export', false, 'HIGH', true, 'Export of research datasets out of the platform. Needs data-sharing agreements with each receiving entity and cross-border approval where relevant. External AI providers are never a recipient.'),
  ('wound.presentations', false, 'HIGH', true, 'Presentation case library (nomination, patient approval of the exact case, second approver). Needs legal and medical-affairs approval of the presentation permission and case-approval wording.'),
  ('wound.presentation_export', false, 'HIGH', true, 'Export of approved presentation cases (PDF / image package) for use outside the platform. Needs legal and medical-affairs approval of the export process.'),
  ('wound.similar_cases', false, 'HIGH', true, 'Similar-case retrieval for clinicians (educational context). Needs clinical validation of the similarity method; image embeddings are not validated.');

-- ------------------------------------------------------------------ helpers
CREATE FUNCTION app.is_internal_test_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM app.user_profiles WHERE user_id = app.current_user_id() AND account_kind = 'INTERNAL_TEST')
$$;

-- A profile holds test data when it is a demo profile, or when it is managed only by review /
-- internal-test accounts (a real account managing it makes it real).
CREATE FUNCTION app.patient_is_test(p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce((SELECT is_demo FROM app.patients WHERE id = p_patient), false)
      OR (EXISTS (SELECT 1 FROM app.patient_access pa JOIN app.user_profiles up ON up.user_id = pa.user_id
                  WHERE pa.patient_id = p_patient AND pa.status = 'ACTIVE' AND up.account_kind IN ('REVIEW', 'INTERNAL_TEST'))
          AND NOT EXISTS (SELECT 1 FROM app.patient_access pa JOIN app.user_profiles up ON up.user_id = pa.user_id
                  WHERE pa.patient_id = p_patient AND pa.status = 'ACTIVE' AND up.account_kind = 'STANDARD'))
$$;

-- Real data needs the flag on. With it off, an internal-test account may use the feature on test data only.
CREATE FUNCTION app.wound_feature_available(p_flag text, p_test_data boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce((SELECT enabled FROM app.feature_flags WHERE key = p_flag), false) OR (p_test_data AND app.is_internal_test_user())
$$;

-- Day numbers follow the calendar in Egypt (a photo taken at 01:00 Cairo time belongs to that day).
CREATE FUNCTION app.wound_local_date(p_at timestamptz) RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (p_at AT TIME ZONE 'Africa/Cairo')::date
$$;
CREATE FUNCTION app.wound_today() RETURNS date
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT (now() AT TIME ZONE 'Africa/Cairo')::date
$$;

CREATE FUNCTION app.wound_region(p_site text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_site IN ('HEAD_FACE', 'NECK') THEN 'HEAD_NECK'
    WHEN p_site IN ('CHEST', 'ABDOMEN', 'BACK') THEN 'TRUNK'
    WHEN p_site IN ('SACRUM_BUTTOCK', 'PERINEAL') THEN 'PELVIS'
    WHEN p_site IN ('SHOULDER_ARM', 'HAND') THEN 'UPPER_LIMB'
    WHEN p_site IN ('HIP_THIGH', 'KNEE_LOWER_LEG', 'ANKLE') THEN 'LOWER_LIMB'
    WHEN p_site IN ('FOOT_TOP', 'FOOT_SOLE', 'HEEL', 'TOE') THEN 'FOOT'
    ELSE 'OTHER' END
$$;
-- Photos of the face, neck or intimate areas are never used for research or presentations.
CREATE FUNCTION app.wound_site_secondary_use_ok(p_site text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_site NOT IN ('HEAD_FACE', 'NECK', 'PERINEAL')
$$;
CREATE FUNCTION app.age_band(p_dob date) RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN age(p_dob) < interval '18 years' THEN 'UNDER_18'
    WHEN age(p_dob) < interval '30 years' THEN '18_29'
    WHEN age(p_dob) < interval '45 years' THEN '30_44'
    WHEN age(p_dob) < interval '60 years' THEN '45_59'
    WHEN age(p_dob) < interval '75 years' THEN '60_74'
    ELSE '75_PLUS' END
$$;

-- ------------------------------------------------------------------ 1. wound-data permissions
INSERT INTO app.settings (key, value, description) VALUES
  ('wound.consent_versions', '{"SCAN": "2026-10-draft", "RESEARCH": "2026-10-draft", "PRESENTATION": "2026-10-draft"}',
   'Current wording versions of the wound-data permissions (A scanning, B research, C presentations). Draft until legal approves the Egyptian Arabic and English text; a new version asks everyone again.');

CREATE FUNCTION app.wound_consent_version(p_purpose text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT value ->> p_purpose FROM app.settings WHERE key = 'wound.consent_versions'
$$;

CREATE TABLE app.wound_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  patient_id uuid NOT NULL REFERENCES app.patients (id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('SCAN', 'RESEARCH', 'PRESENTATION')),
  action text NOT NULL CHECK (action IN ('GRANT', 'WITHDRAW')),
  version text NOT NULL CHECK (length(version) BETWEEN 1 AND 40),
  -- RESEARCH: {"purposes": [...], "recipients": [...]}; PRESENTATION: {"audiences": [...], "organizations": [...]}.
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id text NOT NULL REFERENCES auth."user" ("id"),
  actor_basis text NOT NULL CHECK (actor_basis IN ('SELF', 'GUARDIAN_OF_MINOR', 'LEGAL_AUTHORITY', 'CAREGIVER_FOR_ADULT')),
  reason text CHECK (reason IS NULL OR reason IN ('PERSON_CHOICE', 'SCAN_WITHDRAWN')),
  locale text CHECK (locale IS NULL OR locale IN ('ar', 'en')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX wound_consent_events_idx ON app.wound_consent_events (patient_id, purpose, seq DESC);
-- Append-only: an event is never edited (the whole history goes only with the profile itself).
CREATE TRIGGER wound_consent_events_immutable BEFORE UPDATE ON app.wound_consent_events FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
ALTER TABLE app.wound_consent_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY wound_consent_events_select ON app.wound_consent_events FOR SELECT TO ghayarly_app USING (app.can_view_patient(patient_id));
GRANT SELECT ON app.wound_consent_events TO ghayarly_app;

CREATE FUNCTION app.wound_consent_latest(p_patient uuid, p_purpose text) RETURNS app.wound_consent_events
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT * FROM app.wound_consent_events WHERE patient_id = p_patient AND purpose = p_purpose ORDER BY seq DESC LIMIT 1
$$;
-- Active = the latest event is a GRANT of the CURRENT wording version.
CREATE FUNCTION app.wound_consent_active(p_patient uuid, p_purpose text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce((SELECT e.action = 'GRANT' AND e.version = app.wound_consent_version(p_purpose)
                   FROM app.wound_consent_events e WHERE e.patient_id = p_patient AND e.purpose = p_purpose ORDER BY e.seq DESC LIMIT 1), false)
$$;
CREATE FUNCTION app.wound_consent_scope(p_patient uuid, p_purpose text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT CASE WHEN app.wound_consent_active(p_patient, p_purpose) THEN (app.wound_consent_latest(p_patient, p_purpose)).scope END
$$;
CREATE FUNCTION app.wound_research_covers(p_patient uuid, p_purpose text, p_recipient text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce((SELECT (s -> 'purposes') ? p_purpose AND (s -> 'recipients') ? p_recipient FROM (SELECT app.wound_consent_scope(p_patient, 'RESEARCH') AS s) x), false)
$$;
CREATE FUNCTION app.wound_presentation_covers(p_patient uuid, p_audience text, p_organization text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce((SELECT (s -> 'audiences') ? p_audience AND (s -> 'organizations') ? p_organization FROM (SELECT app.wound_consent_scope(p_patient, 'PRESENTATION') AS s) x), false)
$$;

CREATE FUNCTION app.wound_consent_scope_valid(p_purpose text, p_scope jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  a text;
  b text;
  va text[];
  vb text[];
BEGIN
  IF p_purpose = 'SCAN' THEN RETURN p_scope = '{}'::jsonb; END IF;
  IF p_purpose = 'RESEARCH' THEN
    a := 'purposes'; b := 'recipients';
    va := ARRAY['AI_EVALUATION', 'AI_IMPROVEMENT', 'CASE_COMPARISON', 'HEALING_TRAJECTORIES', 'CARE_PRACTICES', 'PRODUCT_OUTCOMES'];
    vb := ARRAY['DMW_CLINICAL_RESEARCH', 'ALIA_GROUP', 'TETRASOL'];
  ELSIF p_purpose = 'PRESENTATION' THEN
    a := 'audiences'; b := 'organizations';
    va := ARRAY['INTERNAL_TRAINING', 'HEALTHCARE_PROFESSIONALS', 'APPROVED_PARTNERS', 'EDUCATIONAL_CASE_STUDIES'];
    vb := ARRAY['ALIA_GROUP', 'TETRASOL'];
  ELSE
    RETURN false;
  END IF;
  IF jsonb_typeof(p_scope) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_scope)) <> 2
     OR jsonb_typeof(p_scope -> a) <> 'array' OR jsonb_typeof(p_scope -> b) <> 'array'
     OR jsonb_array_length(p_scope -> a) = 0 OR jsonb_array_length(p_scope -> b) = 0 THEN
    RETURN false;
  END IF;
  RETURN (SELECT bool_and(jsonb_typeof(v) = 'string' AND v #>> '{}' = ANY (va)) FROM jsonb_array_elements(p_scope -> a) v)
     AND (SELECT bool_and(jsonb_typeof(v) = 'string' AND v #>> '{}' = ANY (vb)) FROM jsonb_array_elements(p_scope -> b) v)
     AND (SELECT count(DISTINCT v) = count(*) FROM jsonb_array_elements(p_scope -> a) v)
     AND (SELECT count(DISTINCT v) = count(*) FROM jsonb_array_elements(p_scope -> b) v);
END $$;

/*
 * Who may decide for a profile, per purpose. A: anyone who administers the profile (the person,
 * a guardian of a minor, or the consented caregiver of an adult who has not claimed the profile).
 * B and C: only for an adult — the person themself, or a caregiver whose access rests on attested
 * legal authority for an adult who has not claimed the profile. NULL = not allowed.
 */
CREATE FUNCTION app.wound_consent_basis(p_patient uuid, p_purpose text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_pa app.patient_access;
  v_p app.patients;
BEGIN
  SELECT * INTO v_p FROM app.patients WHERE id = p_patient;
  SELECT * INTO v_pa FROM app.patient_access WHERE patient_id = p_patient AND user_id = app.current_user_id() AND status = 'ACTIVE';
  IF v_p.id IS NULL OR v_pa.patient_id IS NULL THEN RETURN NULL; END IF;
  IF p_purpose = 'SCAN' THEN
    IF NOT app.can_administer_patient(p_patient) THEN RETURN NULL; END IF;
    RETURN CASE v_pa.access_level
      WHEN 'OWNER' THEN 'SELF'
      WHEN 'GUARDIAN' THEN 'GUARDIAN_OF_MINOR'
      ELSE CASE WHEN v_pa.consent_basis = 'LEGAL_AUTHORITY_ATTESTED' THEN 'LEGAL_AUTHORITY' ELSE 'CAREGIVER_FOR_ADULT' END END;
  END IF;
  IF age(v_p.date_of_birth) < interval '18 years' THEN RETURN NULL; END IF;
  IF v_pa.access_level = 'OWNER' THEN RETURN 'SELF'; END IF;
  IF v_pa.access_level = 'CAREGIVER' AND v_pa.consent_basis = 'LEGAL_AUTHORITY_ATTESTED' AND v_p.linked_user_id IS NULL THEN RETURN 'LEGAL_AUTHORITY'; END IF;
  RETURN NULL;
END $$;

-- ------------------------------------------------------------------ 2. Clinical Wound Vault
CREATE TABLE app.wound_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES app.patients (id) ON DELETE CASCADE,
  created_by_user_id text NOT NULL REFERENCES auth."user" ("id"),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 60),
  body_site text NOT NULL CHECK (body_site IN ('HEAD_FACE', 'NECK', 'CHEST', 'ABDOMEN', 'BACK', 'SACRUM_BUTTOCK', 'PERINEAL', 'SHOULDER_ARM', 'HAND',
                                                'HIP_THIGH', 'KNEE_LOWER_LEG', 'ANKLE', 'FOOT_TOP', 'FOOT_SOLE', 'HEEL', 'TOE', 'OTHER')),
  body_side text NOT NULL DEFAULT 'NOT_APPLICABLE' CHECK (body_side IN ('LEFT', 'RIGHT', 'MIDLINE', 'NOT_APPLICABLE')),
  -- What the person reports. The clinician's classification is separate and is the only one used downstream.
  reported_category text NOT NULL CHECK (reported_category IN ('DIABETIC_FOOT', 'PRESSURE_ULCER', 'SURGICAL', 'BURN', 'CHRONIC', 'OTHER', 'UNSURE')),
  onset_date date CHECK (onset_date IS NULL OR onset_date BETWEEN DATE '1950-01-01' AND current_date + 1),
  -- Days after the first photo when a follow-up photo is due (Day 1 = the first photo).
  follow_up_days int[] NOT NULL DEFAULT '{3,7}' CHECK (cardinality(follow_up_days) <= 20 AND 2 <= ALL (follow_up_days) AND 366 >= ALL (follow_up_days)),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  -- Written only by app.wound_case_confirm (a clinician with an active share).
  clinical_category text CHECK (clinical_category IS NULL OR clinical_category IN ('DIABETIC_FOOT', 'PRESSURE_ULCER', 'SURGICAL', 'BURN', 'CHRONIC', 'OTHER')),
  diabetes text CHECK (diabetes IS NULL OR diabetes IN ('YES', 'NO', 'UNKNOWN')),
  clinically_reviewed_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  clinically_reviewed_at timestamptz,
  -- Written only by app.wound_case_outcome (a clinician with an active share). Never from a photo.
  outcome text CHECK (outcome IS NULL OR outcome IN ('HEALED', 'IMPROVING', 'NO_CHANGE', 'WORSENED', 'REFERRED', 'LOST_TO_FOLLOW_UP')),
  outcome_on date,
  outcome_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  outcome_at timestamptz,
  test_data boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinical_review_consistency CHECK ((clinical_category IS NULL) = (clinically_reviewed_at IS NULL)),
  CONSTRAINT outcome_consistency CHECK ((outcome IS NULL) = (outcome_at IS NULL) AND (outcome IS NULL) = (outcome_on IS NULL))
);
CREATE INDEX wound_cases_patient_idx ON app.wound_cases (patient_id, created_at DESC);
CREATE TRIGGER wound_cases_touch BEFORE UPDATE ON app.wound_cases FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
ALTER TABLE app.wound_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY wound_cases_select ON app.wound_cases FOR SELECT TO ghayarly_app USING (app.can_view_patient(patient_id) OR app.has_care_wound_access(patient_id));
CREATE POLICY wound_cases_insert ON app.wound_cases FOR INSERT TO ghayarly_app WITH CHECK (app.can_edit_patient(patient_id) OR app.has_care_wound_access(patient_id));
CREATE POLICY wound_cases_update ON app.wound_cases FOR UPDATE TO ghayarly_app
  USING (app.can_edit_patient(patient_id) OR app.has_care_wound_access(patient_id)) WITH CHECK (app.can_edit_patient(patient_id) OR app.has_care_wound_access(patient_id));
-- Deleting a case deletes its photos: only someone who administers the profile.
CREATE POLICY wound_cases_delete ON app.wound_cases FOR DELETE TO ghayarly_app USING (app.can_administer_patient(patient_id));
GRANT SELECT, INSERT, DELETE ON app.wound_cases TO ghayarly_app;
GRANT UPDATE (label, body_site, body_side, reported_category, onset_date, follow_up_days, status) ON app.wound_cases TO ghayarly_app;

CREATE FUNCTION app.wound_cases_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  IF current_user = 'ghayarly_app' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.created_by_user_id := app.current_user_id();
      NEW.test_data := app.patient_is_test(NEW.patient_id);
      NEW.clinical_category := NULL; NEW.diabetes := NULL; NEW.clinically_reviewed_by_user_id := NULL; NEW.clinically_reviewed_at := NULL;
      NEW.outcome := NULL; NEW.outcome_on := NULL; NEW.outcome_by_user_id := NULL; NEW.outcome_at := NULL;
      NEW.status := 'OPEN'; NEW.created_at := now(); NEW.updated_at := now();
      IF NOT app.wound_feature_available('wound.registry', NEW.test_data) THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = 'P0001'; END IF;
      IF NOT app.wound_consent_active(NEW.patient_id, 'SCAN') THEN RAISE EXCEPTION 'WOUND_SCAN_CONSENT_REQUIRED' USING ERRCODE = '42501'; END IF;
      IF NOT app.has_care_wound_access(NEW.patient_id) AND NOT app.has_current_consent('HEALTH_DATA_PROCESSING') THEN
        RAISE EXCEPTION 'HEALTH_DATA_CONSENT_REQUIRED' USING ERRCODE = '42501';
      END IF;
      IF (SELECT count(*) FROM app.wound_cases WHERE patient_id = NEW.patient_id) >= 100 THEN RAISE EXCEPTION 'WOUND_CASE_LIMIT' USING ERRCODE = 'P0001'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wound_cases_guard BEFORE INSERT OR UPDATE ON app.wound_cases FOR EACH ROW EXECUTE FUNCTION app.wound_cases_guard();

CREATE FUNCTION app.wound_cases_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  r app.wound_cases := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  PERFORM app.write_audit('wound.case.' || lower(TG_OP), 'wound_case', r.id::text, r.patient_id, jsonb_build_object('site', r.body_site, 'testData', r.test_data));
  RETURN r;
END $$;
CREATE TRIGGER wound_cases_audit AFTER INSERT OR DELETE ON app.wound_cases FOR EACH ROW EXECUTE FUNCTION app.wound_cases_audit();

CREATE TABLE app.wound_images (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES app.wound_cases (id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES app.patients (id) ON DELETE CASCADE,
  uploaded_by_user_id text NOT NULL REFERENCES auth."user" ("id"),
  uploader_role text NOT NULL CHECK (uploader_role IN ('PATIENT', 'CAREGIVER', 'CLINICIAN')),
  -- PENDING while the encrypted objects are being written; never visible, removed if not completed.
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'STORED')),
  original_key text NOT NULL UNIQUE CHECK (original_key ~ '^w/[0-9a-f-]{36}\.o$'),
  derived_key text NOT NULL UNIQUE CHECK (derived_key ~ '^w/[0-9a-f-]{36}\.d$'),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  byte_size int NOT NULL CHECK (byte_size BETWEEN 100 AND 12582912),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  derived_sha256 text NOT NULL CHECK (derived_sha256 ~ '^[0-9a-f]{64}$'),
  width int NOT NULL CHECK (width BETWEEN 1 AND 20000),
  height int NOT NULL CHECK (height BETWEEN 1 AND 20000),
  derived_width int NOT NULL CHECK (derived_width BETWEEN 1 AND 1024),
  derived_height int NOT NULL CHECK (derived_height BETWEEN 1 AND 1024),
  captured_at timestamptz NOT NULL,
  -- CAMERA: the photo's own capture time; DEVICE: reported by the app; UPLOAD: when it reached the server.
  captured_at_source text NOT NULL CHECK (captured_at_source IN ('CAMERA', 'DEVICE', 'UPLOAD')),
  metadata_removed text[] NOT NULL DEFAULT '{}',
  quality jsonb NOT NULL,
  note text CHECK (note IS NULL OR length(note) <= 300),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  stored_at timestamptz,
  CONSTRAINT stored_consistency CHECK ((status = 'STORED') = (stored_at IS NOT NULL))
);
CREATE INDEX wound_images_case_idx ON app.wound_images (case_id, captured_at);
ALTER TABLE app.wound_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY wound_images_select ON app.wound_images FOR SELECT TO ghayarly_app
  USING (status = 'STORED' AND (app.can_view_patient(patient_id) OR app.has_care_wound_access(patient_id)));
-- The profile's administrators may delete any photo; whoever added a photo may remove it within a day.
CREATE POLICY wound_images_delete ON app.wound_images FOR DELETE TO ghayarly_app
  USING (status = 'STORED' AND (app.can_administer_patient(patient_id)
         OR (uploaded_by_user_id = app.current_user_id() AND created_at > now() - interval '24 hours' AND (app.can_view_patient(patient_id) OR app.has_care_wound_access(patient_id)))));
GRANT SELECT, DELETE ON app.wound_images TO ghayarly_app;

CREATE FUNCTION app.wound_images_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF OLD.status = 'STORED' THEN
    PERFORM app.write_audit('wound.image.delete', 'wound_image', OLD.id::text, OLD.patient_id, jsonb_build_object('case', OLD.case_id));
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER wound_images_audit AFTER DELETE ON app.wound_images FOR EACH ROW EXECUTE FUNCTION app.wound_images_audit();

CREATE TABLE app.wound_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES app.wound_cases (id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES app.patients (id) ON DELETE CASCADE,
  image_id uuid REFERENCES app.wound_images (id) ON DELETE SET NULL,
  observed_on date NOT NULL CHECK (observed_on BETWEEN DATE '2000-01-01' AND current_date + 1),
  author_user_id text NOT NULL REFERENCES auth."user" ("id"),
  author_role text NOT NULL CHECK (author_role IN ('PATIENT', 'CAREGIVER', 'CLINICIAN')),
  provenance app.provenance NOT NULL,
  pain_score smallint CHECK (pain_score IS NULL OR pain_score BETWEEN 0 AND 10),
  exudate text CHECK (exudate IS NULL OR exudate IN ('NONE', 'LOW', 'MODERATE', 'HIGH')),
  signs text[] NOT NULL DEFAULT '{}' CHECK (signs <@ ARRAY['REDNESS', 'SWELLING', 'WARMTH', 'ODOUR', 'PUS', 'FEVER', 'BLEEDING', 'BLACK_TISSUE', 'NUMBNESS']::text[]),
  length_mm numeric(6, 1) CHECK (length_mm IS NULL OR length_mm BETWEEN 0.1 AND 1000),
  width_mm numeric(6, 1) CHECK (width_mm IS NULL OR width_mm BETWEEN 0.1 AND 1000),
  depth_mm numeric(6, 1) CHECK (depth_mm IS NULL OR depth_mm BETWEEN 0.1 AND 300),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wound_observations_case_idx ON app.wound_observations (case_id, observed_on);
ALTER TABLE app.wound_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY wound_observations_select ON app.wound_observations FOR SELECT TO ghayarly_app USING (app.can_view_patient(patient_id) OR app.has_care_wound_access(patient_id));
CREATE POLICY wound_observations_insert ON app.wound_observations FOR INSERT TO ghayarly_app
  WITH CHECK ((app.can_edit_patient(patient_id) OR app.has_care_wound_access(patient_id))
              AND EXISTS (SELECT 1 FROM app.wound_cases c WHERE c.id = case_id AND c.patient_id = wound_observations.patient_id)
              AND (image_id IS NULL OR EXISTS (SELECT 1 FROM app.wound_images i WHERE i.id = image_id AND i.case_id = wound_observations.case_id)));
CREATE POLICY wound_observations_delete ON app.wound_observations FOR DELETE TO ghayarly_app
  USING (author_user_id = app.current_user_id() AND (app.can_edit_patient(patient_id) OR app.has_care_wound_access(patient_id)));
GRANT SELECT, INSERT, DELETE ON app.wound_observations TO ghayarly_app;

CREATE TABLE app.wound_treatments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES app.wound_cases (id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES app.patients (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('COMPANY_PRODUCT', 'DRESSING', 'MEDICATION', 'OFFLOADING', 'COMPRESSION', 'PROCEDURE', 'OTHER')),
  -- A company product from the catalogue (the store is company-only); other treatments are free text.
  product_id uuid REFERENCES app.products (id) ON DELETE SET NULL,
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 200),
  frequency text CHECK (frequency IS NULL OR length(frequency) <= 60),
  started_on date NOT NULL CHECK (started_on BETWEEN DATE '2000-01-01' AND current_date + 1),
  ended_on date,
  recorded_by_user_id text NOT NULL REFERENCES auth."user" ("id"),
  recorder_role text NOT NULL CHECK (recorder_role IN ('PATIENT', 'CAREGIVER', 'CLINICIAN')),
  provenance app.provenance NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_only_for_company_products CHECK (kind = 'COMPANY_PRODUCT' OR product_id IS NULL),
  CONSTRAINT ends_after_start CHECK (ended_on IS NULL OR ended_on >= started_on)
);
CREATE INDEX wound_treatments_case_idx ON app.wound_treatments (case_id, started_on);
ALTER TABLE app.wound_treatments ENABLE ROW LEVEL SECURITY;
CREATE POLICY wound_treatments_select ON app.wound_treatments FOR SELECT TO ghayarly_app USING (app.can_view_patient(patient_id) OR app.has_care_wound_access(patient_id));
CREATE POLICY wound_treatments_insert ON app.wound_treatments FOR INSERT TO ghayarly_app
  WITH CHECK ((app.can_edit_patient(patient_id) OR app.has_care_wound_access(patient_id))
              AND EXISTS (SELECT 1 FROM app.wound_cases c WHERE c.id = case_id AND c.patient_id = wound_treatments.patient_id));
CREATE POLICY wound_treatments_update ON app.wound_treatments FOR UPDATE TO ghayarly_app
  USING (app.can_edit_patient(patient_id) OR app.has_care_wound_access(patient_id)) WITH CHECK (app.can_edit_patient(patient_id) OR app.has_care_wound_access(patient_id));
CREATE POLICY wound_treatments_delete ON app.wound_treatments FOR DELETE TO ghayarly_app
  USING (recorded_by_user_id = app.current_user_id() AND (app.can_edit_patient(patient_id) OR app.has_care_wound_access(patient_id)));
GRANT SELECT, INSERT, DELETE ON app.wound_treatments TO ghayarly_app;
GRANT UPDATE (ended_on, frequency) ON app.wound_treatments TO ghayarly_app;

-- Observations and treatments: author, role and provenance are facts set here, never by the client.
CREATE FUNCTION app.wound_entry_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE
  v_case app.wound_cases;
  v_role text;
  v_prov app.provenance;
BEGIN
  IF current_user <> 'ghayarly_app' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  SELECT * INTO v_case FROM app.wound_cases WHERE id = NEW.case_id;
  IF NOT app.wound_feature_available('wound.registry', v_case.test_data) THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = 'P0001'; END IF;
  IF NOT app.wound_consent_active(NEW.patient_id, 'SCAN') THEN RAISE EXCEPTION 'WOUND_SCAN_CONSENT_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF app.has_care_wound_access(NEW.patient_id) AND NOT app.can_edit_patient(NEW.patient_id) THEN
    v_role := 'CLINICIAN'; v_prov := 'PROFESSIONALLY_VERIFIED';
  ELSE
    IF NOT app.has_current_consent('HEALTH_DATA_PROCESSING') THEN RAISE EXCEPTION 'HEALTH_DATA_CONSENT_REQUIRED' USING ERRCODE = '42501'; END IF;
    IF (SELECT linked_user_id FROM app.patients WHERE id = NEW.patient_id) = app.current_user_id() THEN v_role := 'PATIENT'; v_prov := 'PATIENT_REPORTED';
    ELSE v_role := 'CAREGIVER'; v_prov := 'CAREGIVER_REPORTED'; END IF;
  END IF;
  IF TG_TABLE_NAME = 'wound_observations' THEN
    NEW.author_user_id := app.current_user_id(); NEW.author_role := v_role;
  ELSE
    NEW.recorded_by_user_id := app.current_user_id(); NEW.recorder_role := v_role;
  END IF;
  NEW.provenance := v_prov;
  NEW.created_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER wound_observations_guard BEFORE INSERT ON app.wound_observations FOR EACH ROW EXECUTE FUNCTION app.wound_entry_guard();
CREATE TRIGGER wound_treatments_guard BEFORE INSERT ON app.wound_treatments FOR EACH ROW EXECUTE FUNCTION app.wound_entry_guard();

-- A company product must exist in the catalogue, and a real case never points at a demo product.
CREATE FUNCTION app.wound_treatments_product_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NEW.kind = 'COMPANY_PRODUCT' THEN
    IF NEW.product_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM app.products pr JOIN app.wound_cases c ON c.id = NEW.case_id WHERE pr.id = NEW.product_id AND (NOT pr.is_demo OR c.test_data)) THEN
      RAISE EXCEPTION 'WOUND_PRODUCT_INVALID' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wound_treatments_product_guard BEFORE INSERT ON app.wound_treatments FOR EACH ROW EXECUTE FUNCTION app.wound_treatments_product_guard();

/*
 * Photo upload, step 1: checks every rule and reserves the row (PENDING) with the object keys the
 * API will write. Step 2 (commit) makes it visible only after both encrypted objects are stored;
 * abort (or the maintenance sweep after an hour) removes it and queues the objects for deletion,
 * so a failed upload never leaves a photo behind.
 */
CREATE FUNCTION app.wound_image_register(
  p_image uuid, p_case uuid, p_content_type text, p_byte_size int, p_sha256 text, p_derived_sha256 text,
  p_width int, p_height int, p_derived_width int, p_derived_height int, p_captured_at timestamptz, p_captured_source text,
  p_metadata_removed text[], p_quality jsonb, p_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_case app.wound_cases;
  v_role text;
  v_at timestamptz := p_captured_at;
  v_src text := p_captured_source;
BEGIN
  SELECT * INTO v_case FROM app.wound_cases WHERE id = p_case;
  IF NOT FOUND OR NOT (app.can_edit_patient(v_case.patient_id) OR app.has_care_wound_access(v_case.patient_id)) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF NOT app.wound_feature_available('wound.registry', v_case.test_data) THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = 'P0001'; END IF;
  IF NOT app.wound_consent_active(v_case.patient_id, 'SCAN') THEN RAISE EXCEPTION 'WOUND_SCAN_CONSENT_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF v_case.status <> 'OPEN' THEN RAISE EXCEPTION 'WOUND_CASE_CLOSED' USING ERRCODE = 'P0001'; END IF;
  IF app.has_care_wound_access(v_case.patient_id) AND NOT app.can_edit_patient(v_case.patient_id) THEN
    v_role := 'CLINICIAN';
  ELSE
    IF NOT app.has_current_consent('HEALTH_DATA_PROCESSING') THEN RAISE EXCEPTION 'HEALTH_DATA_CONSENT_REQUIRED' USING ERRCODE = '42501'; END IF;
    v_role := CASE WHEN (SELECT linked_user_id FROM app.patients WHERE id = v_case.patient_id) = app.current_user_id() THEN 'PATIENT' ELSE 'CAREGIVER' END;
  END IF;
  IF (SELECT count(*) FROM app.wound_images WHERE case_id = p_case) >= 200 THEN RAISE EXCEPTION 'WOUND_IMAGE_LIMIT' USING ERRCODE = 'P0001'; END IF;
  IF (SELECT count(*) FROM app.wound_images WHERE uploaded_by_user_id = app.current_user_id() AND created_at > clock_timestamp() - interval '24 hours') >= 60 THEN
    RAISE EXCEPTION 'WOUND_UPLOAD_DAILY_LIMIT' USING ERRCODE = 'P0001';
  END IF;
  IF p_captured_source NOT IN ('CAMERA', 'DEVICE') OR v_at IS NULL OR v_at > clock_timestamp() + interval '1 day' OR v_at < clock_timestamp() - interval '2 years' THEN
    v_at := clock_timestamp(); v_src := 'UPLOAD';
  END IF;
  INSERT INTO app.wound_images (id, case_id, patient_id, uploaded_by_user_id, uploader_role, original_key, derived_key, content_type, byte_size, sha256, derived_sha256,
                                width, height, derived_width, derived_height, captured_at, captured_at_source, metadata_removed, quality, note)
  VALUES (p_image, p_case, v_case.patient_id, app.current_user_id(), v_role, 'w/' || p_image || '.o', 'w/' || p_image || '.d', p_content_type, p_byte_size, p_sha256, p_derived_sha256,
          p_width, p_height, p_derived_width, p_derived_height, v_at, v_src, coalesce(p_metadata_removed, '{}'), coalesce(p_quality, '{}'::jsonb), nullif(btrim(p_note), ''));
  RETURN jsonb_build_object('originalKey', 'w/' || p_image || '.o', 'derivedKey', 'w/' || p_image || '.d');
END $$;

CREATE FUNCTION app.wound_image_commit(p_image uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.wound_images;
BEGIN
  UPDATE app.wound_images SET status = 'STORED', stored_at = clock_timestamp()
   WHERE id = p_image AND status = 'PENDING' AND uploaded_by_user_id = app.current_user_id() RETURNING * INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'WOUND_IMAGE_INVALID' USING ERRCODE = 'P0001'; END IF;
  PERFORM app.write_audit('wound.image.store', 'wound_image', v.id::text, v.patient_id,
    jsonb_build_object('case', v.case_id, 'bytes', v.byte_size, 'contentType', v.content_type, 'metadataRemoved', v.metadata_removed, 'by', v.uploader_role));
END $$;

CREATE FUNCTION app.wound_image_abort(p_image uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = app, pg_temp AS $$
  DELETE FROM app.wound_images WHERE id = p_image AND status = 'PENDING' AND uploaded_by_user_id = app.current_user_id()
$$;

-- Clinician-only: classification (and diabetes status) from the clinician's own assessment.
CREATE FUNCTION app.wound_case_confirm(p_case uuid, p_category text, p_diabetes text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.wound_cases;
BEGIN
  SELECT * INTO v FROM app.wound_cases WHERE id = p_case FOR UPDATE;
  IF NOT FOUND OR NOT app.has_care_wound_access(v.patient_id) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF p_category NOT IN ('DIABETIC_FOOT', 'PRESSURE_ULCER', 'SURGICAL', 'BURN', 'CHRONIC', 'OTHER') OR (p_diabetes IS NOT NULL AND p_diabetes NOT IN ('YES', 'NO', 'UNKNOWN')) THEN
    RAISE EXCEPTION 'INVALID_VALUE' USING ERRCODE = 'P0001';
  END IF;
  UPDATE app.wound_cases SET clinical_category = p_category, diabetes = coalesce(p_diabetes, diabetes),
    clinically_reviewed_by_user_id = app.current_user_id(), clinically_reviewed_at = clock_timestamp() WHERE id = p_case;
  PERFORM app.write_audit('wound.case.clinical_review', 'wound_case', p_case::text, v.patient_id, jsonb_build_object('category', p_category));
END $$;

CREATE FUNCTION app.wound_case_outcome(p_case uuid, p_outcome text, p_on date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.wound_cases;
BEGIN
  SELECT * INTO v FROM app.wound_cases WHERE id = p_case FOR UPDATE;
  IF NOT FOUND OR NOT app.has_care_wound_access(v.patient_id) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF p_outcome NOT IN ('HEALED', 'IMPROVING', 'NO_CHANGE', 'WORSENED', 'REFERRED', 'LOST_TO_FOLLOW_UP') THEN RAISE EXCEPTION 'INVALID_VALUE' USING ERRCODE = 'P0001'; END IF;
  IF v.clinical_category IS NULL THEN RAISE EXCEPTION 'WOUND_CLASSIFICATION_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  IF p_on IS NULL OR p_on > current_date OR p_on < coalesce((SELECT app.wound_local_date(min(captured_at)) FROM app.wound_images WHERE case_id = p_case AND status = 'STORED'), v.created_at::date) THEN
    RAISE EXCEPTION 'INVALID_VALUE' USING ERRCODE = 'P0001';
  END IF;
  UPDATE app.wound_cases SET outcome = p_outcome, outcome_on = p_on, outcome_by_user_id = app.current_user_id(), outcome_at = clock_timestamp() WHERE id = p_case;
  PERFORM app.write_audit('wound.case.outcome', 'wound_case', p_case::text, v.patient_id, jsonb_build_object('outcome', p_outcome));
END $$;

-- ------------------------------------------------------------------ storage purge queue
-- Objects whose rows were deleted (photo, case, profile or account deletion; withdrawal; retention).
CREATE TABLE app.storage_purge_queue (
  object_key text PRIMARY KEY,
  reason text NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts int NOT NULL DEFAULT 0,
  last_error text
);
ALTER TABLE app.storage_purge_queue ENABLE ROW LEVEL SECURITY;
-- No policies / grants: only the functions below (system context) touch the queue.

CREATE FUNCTION app.wound_images_purge() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  INSERT INTO app.storage_purge_queue (object_key, reason) VALUES (OLD.original_key, 'WOUND_IMAGE_DELETED'), (OLD.derived_key, 'WOUND_IMAGE_DELETED')
  ON CONFLICT (object_key) DO NOTHING;
  RETURN OLD;
END $$;
CREATE TRIGGER wound_images_purge AFTER DELETE ON app.wound_images FOR EACH ROW EXECUTE FUNCTION app.wound_images_purge();

-- The purge worker runs without a user (system context); a signed-in user can neither read nor clear the queue.
CREATE FUNCTION app.storage_purge_claim(p_limit int) RETURNS SETOF text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.current_user_id() IS NOT NULL THEN RAISE EXCEPTION 'SYSTEM_ONLY' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    UPDATE app.storage_purge_queue q SET attempts = q.attempts + 1
     WHERE q.object_key IN (SELECT object_key FROM app.storage_purge_queue WHERE attempts < 20 ORDER BY queued_at LIMIT least(greatest(p_limit, 1), 500) FOR UPDATE SKIP LOCKED)
    RETURNING q.object_key;
END $$;
CREATE FUNCTION app.storage_purge_done(p_keys text[], p_failed text[], p_error text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.current_user_id() IS NOT NULL THEN RAISE EXCEPTION 'SYSTEM_ONLY' USING ERRCODE = '42501'; END IF;
  DELETE FROM app.storage_purge_queue WHERE object_key = ANY (coalesce(p_keys, '{}'));
  UPDATE app.storage_purge_queue SET last_error = left(p_error, 200) WHERE object_key = ANY (coalesce(p_failed, '{}'));
END $$;

-- ------------------------------------------------------------------ 3. research registry
CREATE TABLE app.wound_research_secrets (
  id int PRIMARY KEY CHECK (id = 1),
  pseudonym_key text NOT NULL
);
INSERT INTO app.wound_research_secrets (id, pseudonym_key) VALUES (1, replace(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
ALTER TABLE app.wound_research_secrets ENABLE ROW LEVEL SECURITY;
-- No policies / grants: the key never leaves the database.

-- Keyed pseudonym, stable across versions of one dataset lineage, different between lineages.
-- Pseudonymised data is still personal data: it is treated as such (access control, audit, retention).
CREATE FUNCTION app.wound_pseudonym(p_scope uuid, p_case uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT 'W' || upper(left(encode(sha256(convert_to((SELECT pseudonym_key FROM app.wound_research_secrets WHERE id = 1) || ':' || p_scope::text || ':' || p_case::text, 'UTF8')), 'hex'), 12))
$$;

CREATE TABLE app.wound_research_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lineage_id uuid NOT NULL,
  version int NOT NULL DEFAULT 1 CHECK (version >= 1),
  previous_version_id uuid REFERENCES app.wound_research_datasets (id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 3 AND 120),
  description text CHECK (description IS NULL OR length(description) <= 1000),
  purpose text NOT NULL CHECK (purpose IN ('AI_EVALUATION', 'AI_IMPROVEMENT', 'CASE_COMPARISON', 'HEALING_TRAJECTORIES', 'CARE_PRACTICES', 'PRODUCT_OUTCOMES')),
  recipient text NOT NULL CHECK (recipient IN ('DMW_CLINICAL_RESEARCH', 'ALIA_GROUP', 'TETRASOL')),
  -- {"categories": [...], "minImages": n}
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'FROZEN', 'RETIRED')),
  test_data boolean NOT NULL,
  created_by_user_id text NOT NULL REFERENCES auth."user" ("id"),
  approval_reference text CHECK (approval_reference IS NULL OR length(btrim(approval_reference)) BETWEEN 3 AND 300),
  retention_until date,
  frozen_by_user_id text REFERENCES auth."user" ("id"),
  frozen_at timestamptz,
  frozen_item_count int,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (lineage_id, version),
  CONSTRAINT frozen_has_approval CHECK (status = 'DRAFT' OR (approval_reference IS NOT NULL AND retention_until IS NOT NULL AND frozen_at IS NOT NULL) OR retired_at IS NOT NULL)
);
ALTER TABLE app.wound_research_datasets ENABLE ROW LEVEL SECURITY;
CREATE POLICY wound_research_datasets_select ON app.wound_research_datasets FOR SELECT TO ghayarly_app
  USING ((app.has_permission('wound.research.access') OR app.has_permission('wound.research.review') OR app.has_permission('wound.registry.read'))
         AND test_data = app.is_review_account());
GRANT SELECT ON app.wound_research_datasets TO ghayarly_app;

CREATE TABLE app.wound_research_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES app.wound_research_datasets (id) ON DELETE CASCADE,
  pseudonym text NOT NULL,
  -- De-identified: category, coarse region, age band, sex, day numbers, structured observations,
  -- treatments and clinician-confirmed outcome. No names, identifiers, free text or dates.
  snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'INCLUDED' CHECK (status IN ('INCLUDED', 'WITHDRAWN')),
  quality_status text NOT NULL DEFAULT 'PENDING' CHECK (quality_status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
  quality_note text CHECK (quality_note IS NULL OR length(quality_note) <= 500),
  reviewed_by_user_id text REFERENCES auth."user" ("id"),
  reviewed_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (dataset_id, pseudonym)
);
ALTER TABLE app.wound_research_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY wound_research_items_select ON app.wound_research_items FOR SELECT TO ghayarly_app
  USING ((app.has_permission('wound.research.access') OR app.has_permission('wound.research.review'))
         AND EXISTS (SELECT 1 FROM app.wound_research_datasets d WHERE d.id = dataset_id AND d.test_data = app.is_review_account()
                     AND app.wound_feature_available('wound.research', d.test_data)));
GRANT SELECT ON app.wound_research_items TO ghayarly_app;

-- The only way back from a research item to a person. No policies, no grants: database functions only.
CREATE TABLE app.wound_research_links (
  item_id uuid PRIMARY KEY REFERENCES app.wound_research_items (id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES app.wound_cases (id) ON DELETE CASCADE,
  patient_id uuid NOT NULL
);
CREATE INDEX wound_research_links_case_idx ON app.wound_research_links (case_id);
CREATE INDEX wound_research_links_patient_idx ON app.wound_research_links (patient_id);
ALTER TABLE app.wound_research_links ENABLE ROW LEVEL SECURITY;

-- Research copies: freshly re-encoded derivatives (no metadata), their own encrypted objects.
CREATE TABLE app.wound_research_images (
  id uuid PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES app.wound_research_items (id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE CHECK (storage_key ~ '^r/[0-9a-f-]{36}\.j$'),
  day int NOT NULL CHECK (day >= 1),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'READY')),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX wound_research_images_item_idx ON app.wound_research_images (item_id, day);
ALTER TABLE app.wound_research_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY wound_research_images_select ON app.wound_research_images FOR SELECT TO ghayarly_app
  USING (status = 'READY' AND EXISTS (SELECT 1 FROM app.wound_research_items i WHERE i.id = item_id AND i.status = 'INCLUDED'));
GRANT SELECT ON app.wound_research_images TO ghayarly_app;

CREATE FUNCTION app.wound_research_images_purge() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  INSERT INTO app.storage_purge_queue (object_key, reason) VALUES (OLD.storage_key, 'RESEARCH_IMAGE_DELETED') ON CONFLICT (object_key) DO NOTHING;
  RETURN OLD;
END $$;
CREATE TRIGGER wound_research_images_purge AFTER DELETE ON app.wound_research_images FOR EACH ROW EXECUTE FUNCTION app.wound_research_images_purge();

CREATE TABLE app.wound_research_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES app.wound_research_datasets (id),
  recipient text NOT NULL,
  item_count int NOT NULL,
  requested_by_user_id text NOT NULL REFERENCES auth."user" ("id"),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE app.wound_research_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY wound_research_exports_select ON app.wound_research_exports FOR SELECT TO ghayarly_app
  USING ((app.has_permission('wound.research.access') OR app.has_permission('wound.registry.read'))
         AND EXISTS (SELECT 1 FROM app.wound_research_datasets d WHERE d.id = dataset_id AND d.test_data = app.is_review_account()));
GRANT SELECT ON app.wound_research_exports TO ghayarly_app;

-- The de-identified snapshot of a case: day numbers relative to the first photo (Day 1), never dates.
CREATE FUNCTION app.wound_case_snapshot(p_case uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  c app.wound_cases;
  p app.patients;
  v_first date;
BEGIN
  SELECT * INTO c FROM app.wound_cases WHERE id = p_case;
  SELECT * INTO p FROM app.patients WHERE id = c.patient_id;
  v_first := coalesce((SELECT app.wound_local_date(min(captured_at)) FROM app.wound_images WHERE case_id = p_case AND status = 'STORED'), c.created_at::date);
  RETURN jsonb_build_object(
    'category', c.clinical_category,
    'region', app.wound_region(c.body_site),
    'side', c.body_side,
    'ageBand', app.age_band(p.date_of_birth),
    'sex', p.sex,
    'diabetes', c.diabetes,
    'daysSinceOnsetAtDay1', CASE WHEN c.onset_date IS NOT NULL AND c.onset_date <= v_first THEN v_first - c.onset_date END,
    'photoDays', coalesce((SELECT jsonb_agg(d ORDER BY d) FROM (SELECT DISTINCT (app.wound_local_date(captured_at) - v_first + 1) AS d FROM app.wound_images WHERE case_id = p_case AND status = 'STORED') x), '[]'::jsonb),
    'observations', coalesce((SELECT jsonb_agg(jsonb_build_object('day', o.observed_on - v_first + 1, 'source', o.provenance, 'pain', o.pain_score, 'exudate', o.exudate,
                                                               'signs', to_jsonb(o.signs), 'lengthMm', o.length_mm, 'widthMm', o.width_mm, 'depthMm', o.depth_mm) ORDER BY o.observed_on, o.created_at)
                              FROM app.wound_observations o WHERE o.case_id = p_case), '[]'::jsonb),
    'treatments', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', t.kind, 'product', pr.slug, 'startDay', t.started_on - v_first + 1,
                                                             'endDay', t.ended_on - v_first + 1, 'source', t.provenance) ORDER BY t.started_on)
                            FROM app.wound_treatments t LEFT JOIN app.products pr ON pr.id = t.product_id WHERE t.case_id = p_case), '[]'::jsonb),
    'outcome', c.outcome,
    'outcomeDay', CASE WHEN c.outcome_on IS NOT NULL THEN c.outcome_on - v_first + 1 END,
    'scheduledDays', to_jsonb(c.follow_up_days)
  );
END $$;

-- Datasets of the caller's own kind (test datasets for test accounts, real ones otherwise).
CREATE FUNCTION app.wound_research_dataset_for_update(p_dataset uuid) RETURNS app.wound_research_datasets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.wound_research_datasets;
BEGIN
  SELECT * INTO v FROM app.wound_research_datasets WHERE id = p_dataset FOR UPDATE;
  IF NOT FOUND OR v.test_data <> app.is_review_account() THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF NOT app.wound_feature_available('wound.research', v.test_data) THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = 'P0001'; END IF;
  RETURN v;
END $$;

CREATE FUNCTION app.wound_research_dataset_create(p_name text, p_purpose text, p_recipient text, p_description text, p_criteria jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_test boolean := app.is_review_account();
BEGIN
  IF NOT app.has_permission('wound.research.access') THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF NOT app.wound_feature_available('wound.research', v_test) THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = 'P0001'; END IF;
  IF jsonb_typeof(coalesce(p_criteria, '{}'::jsonb)) <> 'object'
     OR (p_criteria ? 'categories' AND NOT (SELECT coalesce(bool_and(v #>> '{}' IN ('DIABETIC_FOOT', 'PRESSURE_ULCER', 'SURGICAL', 'BURN', 'CHRONIC', 'OTHER')), false) FROM jsonb_array_elements(p_criteria -> 'categories') v))
     OR (p_criteria ? 'minImages' AND NOT ((p_criteria ->> 'minImages') ~ '^[0-9]{1,2}$')) THEN
    RAISE EXCEPTION 'INVALID_VALUE' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO app.wound_research_datasets (id, lineage_id, name, purpose, recipient, description, criteria, test_data, created_by_user_id)
  VALUES (v_id, v_id, p_name, p_purpose, p_recipient, nullif(btrim(p_description), ''), coalesce(p_criteria, '{}'::jsonb), v_test, app.current_user_id());
  PERFORM app.write_audit('wound.research.dataset.create', 'wound_research_dataset', v_id::text, NULL, jsonb_build_object('purpose', p_purpose, 'recipient', p_recipient));
  RETURN v_id;
END $$;

/*
 * Adds every eligible case: same kind (test / real), research permission covering THIS purpose and
 * THIS recipient, clinician-confirmed classification, adult, a body site allowed for secondary use,
 * enough photos. Returns the research copies the API must write (re-encoded from the derivative).
 */
CREATE FUNCTION app.wound_research_dataset_build(p_dataset uuid)
RETURNS TABLE (research_image_id uuid, source_key text, storage_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.wound_research_datasets;
  c record;
  img record;
  v_item uuid;
  v_first date;
  v_rid uuid;
  v_n int := 0;
  v_min int;
BEGIN
  IF NOT app.has_permission('wound.research.access') THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  v := app.wound_research_dataset_for_update(p_dataset);
  IF v.status <> 'DRAFT' THEN RAISE EXCEPTION 'DATASET_NOT_DRAFT' USING ERRCODE = 'P0001'; END IF;
  v_min := greatest(1, coalesce((v.criteria ->> 'minImages')::int, 1));
  FOR c IN
    SELECT wc.id, wc.patient_id FROM app.wound_cases wc JOIN app.patients p ON p.id = wc.patient_id
    WHERE wc.test_data = v.test_data AND wc.clinical_category IS NOT NULL AND app.wound_site_secondary_use_ok(wc.body_site)
      AND age(p.date_of_birth) >= interval '18 years'
      AND app.wound_research_covers(wc.patient_id, v.purpose, v.recipient)
      AND (NOT v.criteria ? 'categories' OR (v.criteria -> 'categories') ? wc.clinical_category)
      AND (SELECT count(*) FROM app.wound_images i WHERE i.case_id = wc.id AND i.status = 'STORED') >= v_min
      AND NOT EXISTS (SELECT 1 FROM app.wound_research_links l JOIN app.wound_research_items it ON it.id = l.item_id WHERE l.case_id = wc.id AND it.dataset_id = p_dataset)
    ORDER BY wc.created_at
    LIMIT 2000
  LOOP
    v_first := coalesce((SELECT app.wound_local_date(min(captured_at)) FROM app.wound_images WHERE case_id = c.id AND status = 'STORED'), current_date);
    INSERT INTO app.wound_research_items (dataset_id, pseudonym, snapshot) VALUES (p_dataset, app.wound_pseudonym(v.lineage_id, c.id), app.wound_case_snapshot(c.id))
    RETURNING id INTO v_item;
    INSERT INTO app.wound_research_links (item_id, case_id, patient_id) VALUES (v_item, c.id, c.patient_id);
    FOR img IN SELECT i.derived_key, i.captured_at FROM app.wound_images i WHERE i.case_id = c.id AND i.status = 'STORED' ORDER BY i.captured_at LIMIT 30 LOOP
      v_rid := gen_random_uuid();
      INSERT INTO app.wound_research_images (id, item_id, storage_key, day) VALUES (v_rid, v_item, 'r/' || v_rid || '.j', app.wound_local_date(img.captured_at) - v_first + 1);
      research_image_id := v_rid; source_key := img.derived_key; storage_key := 'r/' || v_rid || '.j';
      RETURN NEXT;
    END LOOP;
    v_n := v_n + 1;
  END LOOP;
  PERFORM app.write_audit('wound.research.dataset.build', 'wound_research_dataset', p_dataset::text, NULL, jsonb_build_object('added', v_n));
END $$;

CREATE FUNCTION app.wound_research_images_settle(p_ready uuid[], p_hashes text[], p_failed uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT app.has_permission('wound.research.access') THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  UPDATE app.wound_research_images ri SET status = 'READY', sha256 = x.h
    FROM unnest(coalesce(p_ready, '{}'), coalesce(p_hashes, '{}')) AS x(id, h)
   WHERE ri.id = x.id AND ri.status = 'PENDING';
  DELETE FROM app.wound_research_images WHERE id = ANY (coalesce(p_failed, '{}')) AND status = 'PENDING';
END $$;

-- Clinical quality review of each item (before the dataset can be frozen).
CREATE FUNCTION app.wound_research_item_review(p_item uuid, p_decision text, p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_i app.wound_research_items;
  v_d app.wound_research_datasets;
BEGIN
  IF NOT app.has_permission('wound.research.review') THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_i FROM app.wound_research_items WHERE id = p_item FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_d := app.wound_research_dataset_for_update(v_i.dataset_id);
  IF v_d.status <> 'DRAFT' OR v_i.status <> 'INCLUDED' THEN RAISE EXCEPTION 'DATASET_NOT_DRAFT' USING ERRCODE = 'P0001'; END IF;
  IF p_decision NOT IN ('ACCEPTED', 'REJECTED') THEN RAISE EXCEPTION 'INVALID_VALUE' USING ERRCODE = 'P0001'; END IF;
  UPDATE app.wound_research_items SET quality_status = p_decision, quality_note = nullif(btrim(p_note), ''), reviewed_by_user_id = app.current_user_id(), reviewed_at = clock_timestamp()
   WHERE id = p_item;
  PERFORM app.write_audit('wound.research.item.review', 'wound_research_item', p_item::text, NULL, jsonb_build_object('decision', p_decision, 'dataset', v_d.id));
END $$;

CREATE FUNCTION app.wound_research_dataset_freeze(p_dataset uuid, p_approval text, p_retention date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.wound_research_datasets;
  v_n int;
BEGIN
  IF NOT app.has_permission('wound.research.access') THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  v := app.wound_research_dataset_for_update(p_dataset);
  IF v.status <> 'DRAFT' THEN RAISE EXCEPTION 'DATASET_NOT_DRAFT' USING ERRCODE = 'P0001'; END IF;
  IF coalesce(length(btrim(p_approval)), 0) < 3 THEN RAISE EXCEPTION 'APPROVAL_REFERENCE_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  IF p_retention IS NULL OR p_retention < current_date + 30 OR p_retention > current_date + interval '10 years' THEN RAISE EXCEPTION 'RETENTION_INVALID' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM app.wound_research_items WHERE dataset_id = p_dataset AND status = 'INCLUDED' AND quality_status = 'PENDING')
     OR EXISTS (SELECT 1 FROM app.wound_research_images ri JOIN app.wound_research_items i ON i.id = ri.item_id WHERE i.dataset_id = p_dataset AND ri.status = 'PENDING') THEN
    RAISE EXCEPTION 'DATASET_REVIEW_INCOMPLETE' USING ERRCODE = 'P0001';
  END IF;
  -- Rejected and withdrawn items are not part of the frozen version.
  DELETE FROM app.wound_research_items WHERE dataset_id = p_dataset AND (quality_status = 'REJECTED' OR status = 'WITHDRAWN');
  SELECT count(*) INTO v_n FROM app.wound_research_items WHERE dataset_id = p_dataset;
  IF v_n = 0 THEN RAISE EXCEPTION 'DATASET_EMPTY' USING ERRCODE = 'P0001'; END IF;
  UPDATE app.wound_research_datasets SET status = 'FROZEN', approval_reference = btrim(p_approval), retention_until = p_retention,
    frozen_by_user_id = app.current_user_id(), frozen_at = clock_timestamp(), frozen_item_count = v_n WHERE id = p_dataset;
  PERFORM app.write_audit('wound.research.dataset.freeze', 'wound_research_dataset', p_dataset::text, NULL,
    jsonb_build_object('items', v_n, 'approval', btrim(p_approval), 'retentionUntil', p_retention));
END $$;

CREATE FUNCTION app.wound_research_dataset_new_version(p_dataset uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.wound_research_datasets;
  v_id uuid := gen_random_uuid();
BEGIN
  IF NOT app.has_permission('wound.research.access') THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  v := app.wound_research_dataset_for_update(p_dataset);
  IF v.status = 'DRAFT' THEN RAISE EXCEPTION 'DATASET_NOT_FROZEN' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM app.wound_research_datasets WHERE lineage_id = v.lineage_id AND status = 'DRAFT') THEN RAISE EXCEPTION 'DATASET_DRAFT_EXISTS' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO app.wound_research_datasets (id, lineage_id, version, previous_version_id, name, description, purpose, recipient, criteria, test_data, created_by_user_id)
  SELECT v_id, v.lineage_id, (SELECT max(version) + 1 FROM app.wound_research_datasets WHERE lineage_id = v.lineage_id), v.id, v.name, v.description, v.purpose, v.recipient, v.criteria, v.test_data, app.current_user_id();
  PERFORM app.write_audit('wound.research.dataset.version', 'wound_research_dataset', v_id::text, NULL, jsonb_build_object('previous', v.id));
  RETURN v_id;
END $$;

-- Retirement destroys the data (items, research copies); the dataset record and its history stay.
CREATE FUNCTION app.wound_research_dataset_retire_internal(p_dataset uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  DELETE FROM app.wound_research_items WHERE dataset_id = p_dataset;
  UPDATE app.wound_research_datasets SET status = 'RETIRED', retired_at = clock_timestamp() WHERE id = p_dataset;
  PERFORM app.write_audit('wound.research.dataset.retire', 'wound_research_dataset', p_dataset::text, NULL, jsonb_build_object('reason', p_reason));
END $$;
CREATE FUNCTION app.wound_research_dataset_retire(p_dataset uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.wound_research_datasets;
BEGIN
  IF NOT app.has_permission('wound.research.access') THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM app.wound_research_datasets WHERE id = p_dataset FOR UPDATE;
  IF NOT FOUND OR v.test_data <> app.is_review_account() THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v.status = 'RETIRED' THEN RETURN; END IF;
  PERFORM app.wound_research_dataset_retire_internal(p_dataset, 'MANUAL');
END $$;

-- What a permitted export may contain: accepted, still-included items of a frozen dataset.
CREATE FUNCTION app.wound_research_export_manifest(p_dataset uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.wound_research_datasets;
  v_items jsonb;
  v_n int;
BEGIN
  IF NOT app.has_permission('wound.research.access') THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  v := app.wound_research_dataset_for_update(p_dataset);
  IF NOT app.wound_feature_available('wound.research_export', v.test_data) THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = 'P0001'; END IF;
  IF v.status <> 'FROZEN' THEN RAISE EXCEPTION 'DATASET_NOT_FROZEN' USING ERRCODE = 'P0001'; END IF;
  IF v.retention_until < current_date THEN RAISE EXCEPTION 'DATASET_EXPIRED' USING ERRCODE = 'P0001'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('pseudonym', i.pseudonym, 'snapshot', i.snapshot,
           'images', coalesce((SELECT jsonb_agg(jsonb_build_object('key', ri.storage_key, 'day', ri.day, 'sha256', ri.sha256) ORDER BY ri.day)
                               FROM app.wound_research_images ri WHERE ri.item_id = i.id AND ri.status = 'READY'), '[]'::jsonb)) ORDER BY i.pseudonym), '[]'::jsonb),
         count(*)
    INTO v_items, v_n
    FROM app.wound_research_items i WHERE i.dataset_id = p_dataset AND i.status = 'INCLUDED' AND i.quality_status = 'ACCEPTED';
  INSERT INTO app.wound_research_exports (dataset_id, recipient, item_count, requested_by_user_id) VALUES (p_dataset, v.recipient, v_n, app.current_user_id());
  PERFORM app.write_audit('wound.research.export', 'wound_research_dataset', p_dataset::text, NULL, jsonb_build_object('items', v_n, 'recipient', v.recipient));
  RETURN jsonb_build_object('dataset', jsonb_build_object('name', v.name, 'version', v.version, 'purpose', v.purpose, 'recipient', v.recipient,
                            'approvalReference', v.approval_reference, 'retentionUntil', v.retention_until), 'items', v_items);
END $$;

-- ------------------------------------------------------------------ 4. presentation case library
CREATE TABLE app.wound_presentation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES app.wound_cases (id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES app.patients (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'NOMINATED' CHECK (status IN ('NOMINATED', 'AWAITING_PATIENT', 'PATIENT_APPROVED', 'PATIENT_DECLINED', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  test_data boolean NOT NULL,
  nominated_by_user_id text NOT NULL REFERENCES auth."user" ("id"),
  nominated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  prepared_by_user_id text REFERENCES auth."user" ("id"),
  prepared_at timestamptz,
  title text CHECK (title IS NULL OR length(btrim(title)) BETWEEN 3 AND 120),
  summary_en text CHECK (summary_en IS NULL OR length(summary_en) <= 2000),
  summary_ar text CHECK (summary_ar IS NULL OR length(summary_ar) <= 2000),
  audience text CHECK (audience IS NULL OR audience IN ('INTERNAL_TRAINING', 'HEALTHCARE_PROFESSIONALS', 'APPROVED_PARTNERS', 'EDUCATIONAL_CASE_STUDIES')),
  organization text CHECK (organization IS NULL OR organization IN ('ALIA_GROUP', 'TETRASOL')),
  scope_note text CHECK (scope_note IS NULL OR length(btrim(scope_note)) BETWEEN 10 AND 300),
  valid_until date,
  -- Copied from the case when prepared: the clinician-confirmed category and outcome, never a claim.
  clinical_category text,
  clinical_outcome text,
  -- Fingerprint of exactly what the patient was shown; the decision must match it.
  request_hash text CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$'),
  patient_decision_by_user_id text REFERENCES auth."user" ("id"),
  patient_decision_basis text,
  patient_decided_at timestamptz,
  deidentification jsonb,
  approved_by_user_id text REFERENCES auth."user" ("id"),
  approved_at timestamptz,
  closed_reason text CHECK (closed_reason IS NULL OR length(closed_reason) <= 300),
  closed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT second_approver CHECK (approved_by_user_id IS NULL OR approved_by_user_id <> prepared_by_user_id)
);
CREATE UNIQUE INDEX wound_presentation_one_open ON app.wound_presentation_cases (case_id) WHERE status IN ('NOMINATED', 'AWAITING_PATIENT', 'PATIENT_APPROVED', 'APPROVED');
CREATE TRIGGER wound_presentation_cases_touch BEFORE UPDATE ON app.wound_presentation_cases FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
ALTER TABLE app.wound_presentation_cases ENABLE ROW LEVEL SECURITY;
-- The person sees requests about their profile (not internal drafts); approvers see their own kind (test / real).
CREATE POLICY wound_presentation_cases_select ON app.wound_presentation_cases FOR SELECT TO ghayarly_app
  USING ((app.can_view_patient(patient_id) AND status <> 'NOMINATED' AND prepared_at IS NOT NULL)
         OR (app.has_permission('wound.presentation.manage') AND test_data = app.is_review_account()));
GRANT SELECT ON app.wound_presentation_cases TO ghayarly_app;

CREATE TABLE app.wound_presentation_images (
  presentation_id uuid NOT NULL REFERENCES app.wound_presentation_cases (id) ON DELETE CASCADE,
  image_id uuid NOT NULL REFERENCES app.wound_images (id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 6),
  day int NOT NULL CHECK (day >= 1),
  caption_en text NOT NULL CHECK (length(btrim(caption_en)) BETWEEN 1 AND 300),
  caption_ar text NOT NULL CHECK (length(btrim(caption_ar)) BETWEEN 1 AND 300),
  PRIMARY KEY (presentation_id, image_id),
  UNIQUE (presentation_id, position)
);
ALTER TABLE app.wound_presentation_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY wound_presentation_images_select ON app.wound_presentation_images FOR SELECT TO ghayarly_app
  USING (EXISTS (SELECT 1 FROM app.wound_presentation_cases pc WHERE pc.id = presentation_id));
GRANT SELECT ON app.wound_presentation_images TO ghayarly_app;

-- A photo deleted from the vault ends a presentation the person already approved (the approved
-- version no longer exists). Earlier states are protected by the fingerprint check instead.
CREATE FUNCTION app.wound_presentation_images_removed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  UPDATE app.wound_presentation_cases SET status = 'WITHDRAWN', closed_reason = 'PHOTO_DELETED', closed_at = clock_timestamp()
   WHERE id = OLD.presentation_id AND status IN ('PATIENT_APPROVED', 'APPROVED');
  RETURN OLD;
END $$;
CREATE TRIGGER wound_presentation_images_removed AFTER DELETE ON app.wound_presentation_images FOR EACH ROW EXECUTE FUNCTION app.wound_presentation_images_removed();

-- Export history survives the case (no foreign key to it): what was exported, for whom, by whom.
CREATE TABLE app.wound_presentation_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  presentation_id uuid NOT NULL,
  title text NOT NULL,
  format text NOT NULL CHECK (format IN ('PDF', 'IMAGE_PACKAGE')),
  audience text NOT NULL,
  organization text NOT NULL,
  scope_note text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  test_data boolean NOT NULL,
  exported_by_user_id text NOT NULL REFERENCES auth."user" ("id"),
  exported_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE app.wound_presentation_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY wound_presentation_exports_select ON app.wound_presentation_exports FOR SELECT TO ghayarly_app
  USING ((app.has_permission('wound.presentation.manage') OR app.has_permission('wound.registry.read')) AND test_data = app.is_review_account());
GRANT SELECT ON app.wound_presentation_exports TO ghayarly_app;

-- Free text in a presentation never names the person or carries a phone / ID number.
CREATE FUNCTION app.wound_text_identifies(p_patient uuid, p_text text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_text text := ' ' || app.search_normalize(p_text) || ' ';
  w text;
BEGIN
  IF p_text ~ '[0-9٠-٩][0-9٠-٩ -]{5,}[0-9٠-٩]' OR p_text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' THEN RETURN true; END IF;
  FOR w IN SELECT unnest(string_to_array(app.search_normalize((SELECT display_name FROM app.patients WHERE id = p_patient)), ' ')) LOOP
    IF length(w) >= 3 AND position(' ' || w || ' ' IN v_text) > 0 THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END $$;

CREATE FUNCTION app.wound_presentation_require(p_presentation uuid) RETURNS app.wound_presentation_cases
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.wound_presentation_cases;
BEGIN
  IF NOT app.has_permission('wound.presentation.manage') THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM app.wound_presentation_cases WHERE id = p_presentation FOR UPDATE;
  IF NOT FOUND OR v.test_data <> app.is_review_account() THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF NOT app.wound_feature_available('wound.presentations', v.test_data) THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = 'P0001'; END IF;
  RETURN v;
END $$;

-- A case may be put forward only with an active presentation permission, a clinician-confirmed
-- classification and outcome, a body site allowed for secondary use, and at least two photos.
CREATE FUNCTION app.wound_presentation_eligible(p_case uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.wound_cases c JOIN app.patients p ON p.id = c.patient_id
    WHERE c.id = p_case AND app.wound_consent_active(c.patient_id, 'PRESENTATION') AND c.clinical_category IS NOT NULL AND c.outcome IS NOT NULL
      AND app.wound_site_secondary_use_ok(c.body_site) AND age(p.date_of_birth) >= interval '18 years'
      AND (SELECT count(*) FROM app.wound_images i WHERE i.case_id = c.id AND i.status = 'STORED') >= 2)
$$;

CREATE FUNCTION app.wound_presentation_candidates()
RETURNS TABLE (case_id uuid, category text, region text, photo_count int, span_days int, outcome text, audiences jsonb, organizations jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_test boolean := app.is_review_account();
BEGIN
  IF NOT app.has_permission('wound.presentation.manage') THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF NOT app.wound_feature_available('wound.presentations', v_test) THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = 'P0001'; END IF;
  RETURN QUERY
    SELECT c.id, c.clinical_category, app.wound_region(c.body_site),
           (SELECT count(*)::int FROM app.wound_images i WHERE i.case_id = c.id AND i.status = 'STORED'),
           (SELECT (app.wound_local_date(max(captured_at)) - app.wound_local_date(min(captured_at)))::int FROM app.wound_images i WHERE i.case_id = c.id AND i.status = 'STORED'),
           c.outcome, app.wound_consent_scope(c.patient_id, 'PRESENTATION') -> 'audiences', app.wound_consent_scope(c.patient_id, 'PRESENTATION') -> 'organizations'
    FROM app.wound_cases c
    WHERE c.test_data = v_test AND app.wound_presentation_eligible(c.id)
      AND NOT EXISTS (SELECT 1 FROM app.wound_presentation_cases pc WHERE pc.case_id = c.id AND pc.status IN ('NOMINATED', 'AWAITING_PATIENT', 'PATIENT_APPROVED', 'APPROVED'))
    ORDER BY c.updated_at DESC
    LIMIT 200;
END $$;

-- Photos (ids, day numbers, sizes) of ONE case an approver may work on: an eligible candidate or a case with a presentation in progress.
CREATE FUNCTION app.wound_presentation_case_images(p_case uuid)
RETURNS TABLE (image_id uuid, day int, width int, height int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_case app.wound_cases;
  v_first date;
BEGIN
  IF NOT app.has_permission('wound.presentation.manage') THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_case FROM app.wound_cases WHERE id = p_case;
  IF NOT FOUND OR v_case.test_data <> app.is_review_account() OR NOT app.wound_feature_available('wound.presentations', v_case.test_data)
     OR NOT (app.wound_presentation_eligible(p_case)
             OR EXISTS (SELECT 1 FROM app.wound_presentation_cases pc WHERE pc.case_id = p_case AND pc.status IN ('NOMINATED', 'AWAITING_PATIENT', 'PATIENT_APPROVED', 'APPROVED'))) THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  v_first := (SELECT app.wound_local_date(min(i.captured_at)) FROM app.wound_images i WHERE i.case_id = p_case AND i.status = 'STORED');
  RETURN QUERY SELECT i.id, (app.wound_local_date(i.captured_at) - v_first + 1)::int, i.derived_width, i.derived_height
    FROM app.wound_images i WHERE i.case_id = p_case AND i.status = 'STORED' ORDER BY i.captured_at;
END $$;

CREATE FUNCTION app.wound_presentation_nominate(p_case uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_case app.wound_cases;
  v_id uuid;
BEGIN
  IF NOT app.has_permission('wound.presentation.manage') THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_case FROM app.wound_cases WHERE id = p_case;
  IF NOT FOUND OR v_case.test_data <> app.is_review_account() THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF NOT app.wound_feature_available('wound.presentations', v_case.test_data) THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = 'P0001'; END IF;
  IF NOT app.wound_presentation_eligible(p_case) THEN RAISE EXCEPTION 'PRESENTATION_NOT_ELIGIBLE' USING ERRCODE = 'P0001'; END IF;
  BEGIN
    INSERT INTO app.wound_presentation_cases (case_id, patient_id, test_data, nominated_by_user_id) VALUES (p_case, v_case.patient_id, v_case.test_data, app.current_user_id()) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'PRESENTATION_ALREADY_OPEN' USING ERRCODE = 'P0001';
  END;
  PERFORM app.write_audit('wound.presentation.nominate', 'wound_presentation', v_id::text, v_case.patient_id, '{}'::jsonb);
  RETURN v_id;
END $$;

-- The canonical text of a prepared presentation, fingerprinted for the patient's decision.
CREATE FUNCTION app.wound_presentation_fingerprint(p_presentation uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT encode(sha256(convert_to(jsonb_build_object(
    'title', pc.title, 'summaryEn', pc.summary_en, 'summaryAr', pc.summary_ar, 'audience', pc.audience, 'organization', pc.organization,
    'scope', pc.scope_note, 'validUntil', pc.valid_until, 'outcome', pc.clinical_outcome,
    'images', (SELECT jsonb_agg(jsonb_build_object('image', pi.image_id, 'position', pi.position, 'day', pi.day, 'en', pi.caption_en, 'ar', pi.caption_ar) ORDER BY pi.position)
               FROM app.wound_presentation_images pi WHERE pi.presentation_id = pc.id))::text, 'UTF8')), 'hex')
  FROM app.wound_presentation_cases pc WHERE pc.id = p_presentation
$$;

/*
 * Exact photos (1–6, from this case), bilingual captions and summary, audience, organisation,
 * scope and expiry. Free text may not identify the person; the outcome shown is the clinician's.
 * Preparing (again) always goes back to the patient for approval of that exact version.
 */
CREATE FUNCTION app.wound_presentation_prepare(
  p_presentation uuid, p_title text, p_summary_en text, p_summary_ar text, p_audience text, p_organization text,
  p_scope_note text, p_valid_until date, p_images jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.wound_presentation_cases;
  v_case app.wound_cases;
  v_first date;
  r jsonb;
  v_pos int := 0;
  v_img app.wound_images;
  v_hash text;
BEGIN
  v := app.wound_presentation_require(p_presentation);
  IF v.status NOT IN ('NOMINATED', 'AWAITING_PATIENT') THEN RAISE EXCEPTION 'PRESENTATION_NOT_EDITABLE' USING ERRCODE = 'P0001'; END IF;
  IF NOT app.wound_presentation_eligible(v.case_id) THEN RAISE EXCEPTION 'PRESENTATION_NOT_ELIGIBLE' USING ERRCODE = 'P0001'; END IF;
  IF NOT app.wound_presentation_covers(v.patient_id, p_audience, p_organization) THEN RAISE EXCEPTION 'PRESENTATION_AUDIENCE_NOT_PERMITTED' USING ERRCODE = 'P0001'; END IF;
  IF p_valid_until IS NULL OR p_valid_until <= current_date OR p_valid_until > current_date + interval '3 years' THEN RAISE EXCEPTION 'VALIDITY_INVALID' USING ERRCODE = 'P0001'; END IF;
  IF jsonb_typeof(p_images) <> 'array' OR jsonb_array_length(p_images) NOT BETWEEN 1 AND 6 THEN RAISE EXCEPTION 'INVALID_VALUE' USING ERRCODE = 'P0001'; END IF;
  IF app.wound_text_identifies(v.patient_id, concat_ws(' ', p_title, p_summary_en, p_summary_ar, p_scope_note,
       (SELECT string_agg(concat_ws(' ', x ->> 'captionEn', x ->> 'captionAr'), ' ') FROM jsonb_array_elements(p_images) x))) THEN
    RAISE EXCEPTION 'PRESENTATION_TEXT_IDENTIFIES' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_case FROM app.wound_cases WHERE id = v.case_id;
  v_first := (SELECT app.wound_local_date(min(captured_at)) FROM app.wound_images WHERE case_id = v.case_id AND status = 'STORED');
  DELETE FROM app.wound_presentation_images WHERE presentation_id = p_presentation;
  FOR r IN SELECT * FROM jsonb_array_elements(p_images) LOOP
    v_pos := v_pos + 1;
    SELECT * INTO v_img FROM app.wound_images WHERE id = (r ->> 'imageId')::uuid AND case_id = v.case_id AND status = 'STORED';
    IF NOT FOUND THEN RAISE EXCEPTION 'PRESENTATION_PHOTO_INVALID' USING ERRCODE = 'P0001'; END IF;
    INSERT INTO app.wound_presentation_images (presentation_id, image_id, position, day, caption_en, caption_ar)
    VALUES (p_presentation, v_img.id, v_pos, app.wound_local_date(v_img.captured_at) - v_first + 1, r ->> 'captionEn', r ->> 'captionAr');
  END LOOP;
  UPDATE app.wound_presentation_cases SET status = 'AWAITING_PATIENT', title = btrim(p_title), summary_en = btrim(p_summary_en), summary_ar = btrim(p_summary_ar),
    audience = p_audience, organization = p_organization, scope_note = btrim(p_scope_note), valid_until = p_valid_until,
    clinical_category = v_case.clinical_category, clinical_outcome = v_case.outcome, prepared_by_user_id = app.current_user_id(), prepared_at = clock_timestamp(),
    patient_decision_by_user_id = NULL, patient_decision_basis = NULL, patient_decided_at = NULL, closed_reason = NULL, closed_at = NULL
  WHERE id = p_presentation;
  v_hash := app.wound_presentation_fingerprint(p_presentation);
  UPDATE app.wound_presentation_cases SET request_hash = v_hash WHERE id = p_presentation;
  PERFORM app.write_audit('wound.presentation.prepare', 'wound_presentation', p_presentation::text, v.patient_id,
    jsonb_build_object('audience', p_audience, 'organization', p_organization, 'photos', v_pos));
  RETURN v_hash;
END $$;

-- The person (adult self / attested legal authority) approves or declines THIS exact version.
CREATE FUNCTION app.wound_presentation_decide(p_presentation uuid, p_decision text, p_request_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.wound_presentation_cases;
  v_basis text;
BEGIN
  SELECT * INTO v FROM app.wound_presentation_cases WHERE id = p_presentation FOR UPDATE;
  IF NOT FOUND OR NOT app.can_view_patient(v.patient_id) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_basis := app.wound_consent_basis(v.patient_id, 'PRESENTATION');
  IF v_basis IS NULL THEN RAISE EXCEPTION 'WOUND_CONSENT_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF v.status <> 'AWAITING_PATIENT' THEN RAISE EXCEPTION 'PRESENTATION_NOT_AWAITING' USING ERRCODE = 'P0001'; END IF;
  IF p_decision NOT IN ('APPROVE', 'DECLINE') THEN RAISE EXCEPTION 'INVALID_VALUE' USING ERRCODE = 'P0001'; END IF;
  IF p_decision = 'APPROVE' THEN
    IF p_request_hash IS DISTINCT FROM v.request_hash OR p_request_hash IS DISTINCT FROM app.wound_presentation_fingerprint(p_presentation) THEN
      RAISE EXCEPTION 'PRESENTATION_CHANGED' USING ERRCODE = 'P0001';
    END IF;
    IF NOT app.wound_presentation_covers(v.patient_id, v.audience, v.organization) THEN RAISE EXCEPTION 'PRESENTATION_AUDIENCE_NOT_PERMITTED' USING ERRCODE = 'P0001'; END IF;
  END IF;
  UPDATE app.wound_presentation_cases SET status = CASE WHEN p_decision = 'APPROVE' THEN 'PATIENT_APPROVED' ELSE 'PATIENT_DECLINED' END,
    patient_decision_by_user_id = app.current_user_id(), patient_decision_basis = v_basis, patient_decided_at = clock_timestamp(),
    closed_at = CASE WHEN p_decision = 'DECLINE' THEN clock_timestamp() END
  WHERE id = p_presentation;
  PERFORM app.write_audit('wound.presentation.patient_' || lower(p_decision), 'wound_presentation', p_presentation::text, v.patient_id,
    jsonb_build_object('basis', v_basis, 'requestHash', v.request_hash));
END $$;

-- The second approver (not the preparer) confirms the de-identification checklist.
CREATE FUNCTION app.wound_presentation_approve(p_presentation uuid, p_checklist jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.wound_presentation_cases;
  k text;
BEGIN
  v := app.wound_presentation_require(p_presentation);
  IF v.status <> 'PATIENT_APPROVED' THEN RAISE EXCEPTION 'PRESENTATION_NOT_PATIENT_APPROVED' USING ERRCODE = 'P0001'; END IF;
  IF v.prepared_by_user_id = app.current_user_id() THEN RAISE EXCEPTION 'SECOND_APPROVER_REQUIRED' USING ERRCODE = '42501'; END IF;
  FOREACH k IN ARRAY ARRAY['noFace', 'noIdentifyingMarks', 'noJewelleryOrTattoos', 'noBackgroundDetails', 'noNamesDatesOrNumbers', 'outcomeClinicianConfirmed', 'noEfficacyClaims'] LOOP
    IF coalesce((p_checklist ->> k)::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'DEIDENTIFICATION_CHECKLIST_INCOMPLETE' USING ERRCODE = 'P0001'; END IF;
  END LOOP;
  IF v.request_hash IS DISTINCT FROM app.wound_presentation_fingerprint(p_presentation) THEN RAISE EXCEPTION 'PRESENTATION_CHANGED' USING ERRCODE = 'P0001'; END IF;
  IF NOT app.wound_presentation_covers(v.patient_id, v.audience, v.organization) THEN RAISE EXCEPTION 'PRESENTATION_AUDIENCE_NOT_PERMITTED' USING ERRCODE = 'P0001'; END IF;
  UPDATE app.wound_presentation_cases SET status = 'APPROVED', deidentification = p_checklist, approved_by_user_id = app.current_user_id(), approved_at = clock_timestamp()
   WHERE id = p_presentation;
  PERFORM app.write_audit('wound.presentation.approve', 'wound_presentation', p_presentation::text, v.patient_id, jsonb_build_object('preparedBy', v.prepared_by_user_id));
END $$;

CREATE FUNCTION app.wound_presentation_reject(p_presentation uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.wound_presentation_cases;
BEGIN
  v := app.wound_presentation_require(p_presentation);
  IF v.status NOT IN ('NOMINATED', 'AWAITING_PATIENT', 'PATIENT_APPROVED', 'APPROVED') THEN RAISE EXCEPTION 'PRESENTATION_CLOSED' USING ERRCODE = 'P0001'; END IF;
  UPDATE app.wound_presentation_cases SET status = 'REJECTED', closed_reason = left(btrim(p_reason), 300), closed_at = clock_timestamp() WHERE id = p_presentation;
  PERFORM app.write_audit('wound.presentation.reject', 'wound_presentation', p_presentation::text, v.patient_id, '{}'::jsonb);
END $$;

-- The person withdraws one presentation (any state). Copies already distributed cannot be recalled.
CREATE FUNCTION app.wound_presentation_withdraw(p_presentation uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.wound_presentation_cases;
BEGIN
  SELECT * INTO v FROM app.wound_presentation_cases WHERE id = p_presentation FOR UPDATE;
  IF NOT FOUND OR NOT app.can_view_patient(v.patient_id) OR app.wound_consent_basis(v.patient_id, 'PRESENTATION') IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v.status IN ('WITHDRAWN', 'REJECTED', 'PATIENT_DECLINED') THEN RETURN; END IF;
  UPDATE app.wound_presentation_cases SET status = 'WITHDRAWN', closed_reason = 'PATIENT_WITHDREW', closed_at = clock_timestamp() WHERE id = p_presentation;
  PERFORM app.write_audit('wound.presentation.withdraw', 'wound_presentation', p_presentation::text, v.patient_id, '{}'::jsonb);
END $$;

-- What an export may contain: the approved version only, while it is valid and still permitted.
CREATE FUNCTION app.wound_presentation_export_data(p_presentation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.wound_presentation_cases;
BEGIN
  v := app.wound_presentation_require(p_presentation);
  IF NOT app.wound_feature_available('wound.presentation_export', v.test_data) THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = 'P0001'; END IF;
  IF v.status <> 'APPROVED' THEN RAISE EXCEPTION 'PRESENTATION_NOT_APPROVED' USING ERRCODE = 'P0001'; END IF;
  IF v.valid_until < current_date THEN RAISE EXCEPTION 'PRESENTATION_EXPIRED' USING ERRCODE = 'P0001'; END IF;
  IF v.request_hash IS DISTINCT FROM app.wound_presentation_fingerprint(p_presentation) THEN RAISE EXCEPTION 'PRESENTATION_CHANGED' USING ERRCODE = 'P0001'; END IF;
  IF NOT app.wound_presentation_covers(v.patient_id, v.audience, v.organization) THEN RAISE EXCEPTION 'PRESENTATION_AUDIENCE_NOT_PERMITTED' USING ERRCODE = 'P0001'; END IF;
  RETURN jsonb_build_object('id', v.id, 'title', v.title, 'summaryEn', v.summary_en, 'summaryAr', v.summary_ar, 'audience', v.audience, 'organization', v.organization,
    'scope', v.scope_note, 'validUntil', v.valid_until, 'category', v.clinical_category, 'outcome', v.clinical_outcome, 'approvedAt', v.approved_at,
    'images', (SELECT jsonb_agg(jsonb_build_object('key', i.derived_key, 'width', i.derived_width, 'height', i.derived_height, 'day', pi.day, 'captionEn', pi.caption_en, 'captionAr', pi.caption_ar) ORDER BY pi.position)
               FROM app.wound_presentation_images pi JOIN app.wound_images i ON i.id = pi.image_id WHERE pi.presentation_id = v.id));
END $$;

CREATE FUNCTION app.wound_presentation_export_record(p_presentation uuid, p_format text, p_sha256 text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.wound_presentation_cases;
  v_id uuid;
BEGIN
  PERFORM app.wound_presentation_export_data(p_presentation);
  SELECT * INTO v FROM app.wound_presentation_cases WHERE id = p_presentation;
  INSERT INTO app.wound_presentation_exports (presentation_id, title, format, audience, organization, scope_note, sha256, test_data, exported_by_user_id)
  VALUES (v.id, v.title, p_format, v.audience, v.organization, v.scope_note, p_sha256, v.test_data, app.current_user_id()) RETURNING id INTO v_id;
  PERFORM app.write_audit('wound.presentation.export', 'wound_presentation', p_presentation::text, v.patient_id, jsonb_build_object('format', p_format, 'sha256', p_sha256));
  RETURN v_id;
END $$;

-- ------------------------------------------------------------------ withdrawal and deletion
/*
 * Applies the CURRENT permissions of a profile to everything downstream: research items whose
 * purpose / recipient is no longer covered leave draft datasets and are withdrawn (data and copies
 * destroyed) from frozen ones; presentations whose audience is no longer covered are withdrawn.
 */
CREATE FUNCTION app.wound_enforce_permissions(p_patient uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT i.id AS item_id, d.status, d.purpose, d.recipient FROM app.wound_research_links l
      JOIN app.wound_research_items i ON i.id = l.item_id JOIN app.wound_research_datasets d ON d.id = i.dataset_id
     WHERE l.patient_id = p_patient AND i.status = 'INCLUDED'
  LOOP
    IF NOT app.wound_research_covers(p_patient, r.purpose, r.recipient) THEN
      PERFORM app.wound_research_item_withdraw(r.item_id, r.status);
    END IF;
  END LOOP;
  UPDATE app.wound_presentation_cases SET status = 'WITHDRAWN', closed_reason = 'PERMISSION_WITHDRAWN', closed_at = clock_timestamp()
   WHERE patient_id = p_patient AND status IN ('NOMINATED', 'AWAITING_PATIENT', 'PATIENT_APPROVED', 'APPROVED')
     AND (audience IS NULL AND NOT app.wound_consent_active(p_patient, 'PRESENTATION')
          OR audience IS NOT NULL AND NOT app.wound_presentation_covers(p_patient, audience, organization));
END $$;

CREATE FUNCTION app.wound_research_item_withdraw(p_item uuid, p_dataset_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF p_dataset_status = 'DRAFT' THEN
    DELETE FROM app.wound_research_items WHERE id = p_item;
  ELSE
    DELETE FROM app.wound_research_images WHERE item_id = p_item;
    DELETE FROM app.wound_research_links WHERE item_id = p_item;
    UPDATE app.wound_research_items SET status = 'WITHDRAWN', withdrawn_at = clock_timestamp(), snapshot = '{"withdrawn": true}'::jsonb WHERE id = p_item;
  END IF;
  PERFORM app.write_audit('wound.research.item.withdraw', 'wound_research_item', p_item::text, NULL, jsonb_build_object('datasetStatus', p_dataset_status));
END $$;

-- Deleting a case (or the whole profile / account) withdraws it from research first, while the link still exists.
CREATE FUNCTION app.wound_cases_before_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT i.id, d.status FROM app.wound_research_links l JOIN app.wound_research_items i ON i.id = l.item_id
             JOIN app.wound_research_datasets d ON d.id = i.dataset_id WHERE l.case_id = OLD.id AND i.status = 'INCLUDED' LOOP
    PERFORM app.wound_research_item_withdraw(r.id, r.status);
  END LOOP;
  RETURN OLD;
END $$;
CREATE TRIGGER wound_cases_before_delete BEFORE DELETE ON app.wound_cases FOR EACH ROW EXECUTE FUNCTION app.wound_cases_before_delete();

CREATE FUNCTION app.wound_consent_record(p_patient uuid, p_purpose text, p_action text, p_version text, p_scope jsonb, p_locale text)
RETURNS app.wound_consent_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_basis text;
  v_e app.wound_consent_events;
  v_test boolean;
  p text;
BEGIN
  IF NOT app.can_view_patient(p_patient) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF p_purpose NOT IN ('SCAN', 'RESEARCH', 'PRESENTATION') OR p_action NOT IN ('GRANT', 'WITHDRAW') THEN RAISE EXCEPTION 'INVALID_VALUE' USING ERRCODE = 'P0001'; END IF;
  v_basis := app.wound_consent_basis(p_patient, p_purpose);
  IF v_basis IS NULL THEN
    RAISE EXCEPTION '%', CASE WHEN p_purpose <> 'SCAN' AND (SELECT age(date_of_birth) < interval '18 years' FROM app.patients WHERE id = p_patient)
                          THEN 'WOUND_SECONDARY_USE_MINOR' ELSE 'WOUND_CONSENT_NOT_ALLOWED' END USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wound_consent:' || p_patient::text, 0));
  IF p_action = 'GRANT' THEN
    v_test := app.patient_is_test(p_patient);
    IF NOT app.wound_feature_available('wound.registry', v_test) THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = 'P0001'; END IF;
    IF p_version IS DISTINCT FROM app.wound_consent_version(p_purpose) THEN RAISE EXCEPTION 'WOUND_CONSENT_VERSION_OUTDATED' USING ERRCODE = 'P0001'; END IF;
    IF NOT app.wound_consent_scope_valid(p_purpose, coalesce(p_scope, '{}'::jsonb)) THEN RAISE EXCEPTION 'WOUND_CONSENT_SCOPE_INVALID' USING ERRCODE = 'P0001'; END IF;
    IF p_purpose <> 'SCAN' AND NOT app.wound_consent_active(p_patient, 'SCAN') THEN RAISE EXCEPTION 'WOUND_SCAN_CONSENT_REQUIRED' USING ERRCODE = 'P0001'; END IF;
    IF NOT app.has_current_consent('HEALTH_DATA_PROCESSING') THEN RAISE EXCEPTION 'HEALTH_DATA_CONSENT_REQUIRED' USING ERRCODE = '42501'; END IF;
  ELSIF NOT app.wound_consent_active(p_patient, p_purpose) THEN
    -- Nothing to withdraw (never given, already withdrawn, or an outdated version): idempotent.
    SELECT * INTO v_e FROM app.wound_consent_events WHERE patient_id = p_patient AND purpose = p_purpose ORDER BY seq DESC LIMIT 1;
    IF FOUND AND v_e.action = 'WITHDRAW' THEN RETURN v_e; END IF;
  END IF;
  INSERT INTO app.wound_consent_events (patient_id, purpose, action, version, scope, actor_user_id, actor_basis, reason, locale)
  VALUES (p_patient, p_purpose, p_action, coalesce(CASE WHEN p_action = 'GRANT' THEN p_version END, app.wound_consent_version(p_purpose)),
          CASE WHEN p_action = 'GRANT' THEN coalesce(p_scope, '{}'::jsonb) ELSE '{}'::jsonb END, app.current_user_id(), v_basis,
          CASE WHEN p_action = 'WITHDRAW' THEN 'PERSON_CHOICE' END, p_locale)
  RETURNING * INTO v_e;
  PERFORM app.write_audit('wound.consent.' || lower(p_action), 'wound_consent', v_e.id::text, p_patient,
    jsonb_build_object('purpose', p_purpose, 'version', v_e.version, 'scope', v_e.scope, 'basis', v_basis));
  -- Withdrawing the scanning permission withdraws the two optional ones as well.
  IF p_action = 'WITHDRAW' AND p_purpose = 'SCAN' THEN
    FOREACH p IN ARRAY ARRAY['RESEARCH', 'PRESENTATION'] LOOP
      IF app.wound_consent_active(p_patient, p) THEN
        INSERT INTO app.wound_consent_events (patient_id, purpose, action, version, scope, actor_user_id, actor_basis, reason, locale)
        VALUES (p_patient, p, 'WITHDRAW', app.wound_consent_version(p), '{}'::jsonb, app.current_user_id(), v_basis, 'SCAN_WITHDRAWN', p_locale);
        PERFORM app.write_audit('wound.consent.withdraw', 'wound_consent', p_patient::text, p_patient, jsonb_build_object('purpose', p, 'reason', 'SCAN_WITHDRAWN'));
      END IF;
    END LOOP;
  END IF;
  PERFORM app.wound_enforce_permissions(p_patient);
  RETURN v_e;
END $$;

-- "Delete my wound data": every case, photo, observation and treatment of the profile, at once.
-- The permission history and the audit trail are kept (they prove what was allowed and when).
CREATE FUNCTION app.wound_delete_all(p_patient uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_n int;
BEGIN
  IF NOT app.can_administer_patient(p_patient) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  WITH d AS (DELETE FROM app.wound_cases WHERE patient_id = p_patient RETURNING 1) SELECT count(*) INTO v_n FROM d;
  PERFORM app.write_audit('wound.data.delete_all', 'patient', p_patient::text, p_patient, jsonb_build_object('cases', v_n));
  RETURN v_n;
END $$;

-- ------------------------------------------------------------------ 5. similar cases (foundation)
-- Image embeddings, when a validated method exists. None does: no row is written by the application,
-- and retrieval ignores anything not marked validated.
CREATE TABLE app.wound_case_embeddings (
  case_id uuid PRIMARY KEY REFERENCES app.wound_cases (id) ON DELETE CASCADE,
  method text NOT NULL,
  vector real[] NOT NULL,
  validated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE app.wound_case_embeddings ENABLE ROW LEVEL SECURITY;

/*
 * For a clinician with an active share: other cases with the SAME clinician-confirmed category,
 * whose people allowed CASE_COMPARISON research by the clinical research team, as pseudonymous,
 * structured summaries (no photos, no free text, no product names). Educational only.
 */
CREATE FUNCTION app.wound_similar_cases(p_case uuid, p_limit int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.wound_cases;
  v_out jsonb;
BEGIN
  SELECT * INTO v FROM app.wound_cases WHERE id = p_case;
  IF NOT FOUND OR NOT app.has_care_wound_access(v.patient_id) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF NOT app.wound_feature_available('wound.similar_cases', v.test_data) THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = 'P0001'; END IF;
  IF v.clinical_category IS NULL THEN RAISE EXCEPTION 'WOUND_CLASSIFICATION_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  SELECT coalesce(jsonb_agg(x.summary ORDER BY x.score DESC, x.photos DESC), '[]'::jsonb) INTO v_out FROM (
    SELECT jsonb_build_object(
             'ref', app.wound_pseudonym('00000000-0000-0000-0000-000000000000', c.id),
             'category', c.clinical_category, 'region', app.wound_region(c.body_site), 'ageBand', app.age_band(p.date_of_birth), 'diabetes', c.diabetes,
             'photoCount', (SELECT count(*) FROM app.wound_images i WHERE i.case_id = c.id AND i.status = 'STORED'),
             'followUpDays', (SELECT app.wound_local_date(max(captured_at)) - app.wound_local_date(min(captured_at)) + 1 FROM app.wound_images i WHERE i.case_id = c.id AND i.status = 'STORED'),
             'outcome', c.outcome,
             'treatmentKinds', coalesce((SELECT jsonb_agg(DISTINCT t.kind) FROM app.wound_treatments t WHERE t.case_id = c.id), '[]'::jsonb),
             'matchedOn', jsonb_build_array('CATEGORY') || CASE WHEN app.wound_region(c.body_site) = app.wound_region(v.body_site) THEN '["REGION"]'::jsonb ELSE '[]'::jsonb END
                          || CASE WHEN c.diabetes IS NOT NULL AND c.diabetes = v.diabetes THEN '["DIABETES"]'::jsonb ELSE '[]'::jsonb END) AS summary,
           (CASE WHEN app.wound_region(c.body_site) = app.wound_region(v.body_site) THEN 2 ELSE 0 END + CASE WHEN c.diabetes = v.diabetes THEN 1 ELSE 0 END) AS score,
           (SELECT count(*) FROM app.wound_images i WHERE i.case_id = c.id AND i.status = 'STORED') AS photos
      FROM app.wound_cases c JOIN app.patients p ON p.id = c.patient_id
     WHERE c.id <> v.id AND c.patient_id <> v.patient_id AND c.test_data = v.test_data AND c.clinical_category = v.clinical_category
       AND app.wound_site_secondary_use_ok(c.body_site) AND age(p.date_of_birth) >= interval '18 years'
       AND app.wound_research_covers(c.patient_id, 'CASE_COMPARISON', 'DMW_CLINICAL_RESEARCH')
     ORDER BY 2 DESC, 3 DESC
     LIMIT least(greatest(p_limit, 1), 20)) x;
  PERFORM app.write_audit('wound.similar_cases.view', 'wound_case', p_case::text, v.patient_id, jsonb_build_object('results', jsonb_array_length(v_out)));
  RETURN v_out;
END $$;

-- ------------------------------------------------------------------ 6. product-outcome analytics
/*
 * Descriptive, observational counts per clinician-confirmed category × company product, over cases
 * whose people allowed PRODUCT_OUTCOMES research. Groups under 5 cases are suppressed. Nothing here
 * supports a causal or comparative claim; there is no control group and treatment is not assigned.
 */
CREATE FUNCTION app.wound_product_outcomes() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_test boolean := app.is_review_account();
  v_out jsonb;
BEGIN
  IF NOT app.has_permission('wound.research.access') THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF NOT app.wound_feature_available('wound.research', v_test) THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = 'P0001'; END IF;
  WITH cases AS (
    SELECT c.*, (SELECT app.wound_local_date(min(captured_at)) FROM app.wound_images i WHERE i.case_id = c.id AND i.status = 'STORED') AS day1
      FROM app.wound_cases c JOIN app.patients p ON p.id = c.patient_id
     WHERE c.test_data = v_test AND c.clinical_category IS NOT NULL AND age(p.date_of_birth) >= interval '18 years'
       AND app.wound_research_covers(c.patient_id, 'PRODUCT_OUTCOMES', 'DMW_CLINICAL_RESEARCH')
  ), usage AS (
    SELECT c.id AS case_id, coalesce(pr.slug, 'NONE_RECORDED') AS product, coalesce(pr.name_en, 'No company product recorded') AS product_name,
           min(t.started_on) AS started
      FROM cases c
      LEFT JOIN app.wound_treatments t ON t.case_id = c.id AND t.kind = 'COMPANY_PRODUCT'
      LEFT JOIN app.products pr ON pr.id = t.product_id
     GROUP BY 1, 2, 3
  ), rows AS (
    SELECT c.clinical_category AS category, u.product, u.product_name, c.id, c.outcome, c.outcome_on, c.day1, u.started,
           EXISTS (SELECT 1 FROM app.wound_treatments t WHERE t.case_id = c.id AND t.kind <> 'COMPANY_PRODUCT') AS other_treatment,
           (SELECT count(*) FROM unnest(c.follow_up_days) d WHERE c.day1 + d - 1 <= app.wound_today()) AS due,
           (SELECT count(*) FROM unnest(c.follow_up_days) d WHERE c.day1 + d - 1 <= app.wound_today()
              AND EXISTS (SELECT 1 FROM app.wound_images i WHERE i.case_id = c.id AND i.status = 'STORED' AND abs(app.wound_local_date(i.captured_at) - (c.day1 + d - 1)) <= 1)) AS met
      FROM cases c JOIN usage u ON u.case_id = c.id
  )
  SELECT coalesce(jsonb_agg(g ORDER BY g ->> 'category', g ->> 'product'), '[]'::jsonb) INTO v_out FROM (
    SELECT CASE WHEN count(*) < 5 THEN jsonb_build_object('category', category, 'product', product, 'productName', product_name, 'suppressed', true)
      ELSE jsonb_build_object(
        'category', category, 'product', product, 'productName', product_name, 'suppressed', false,
        'cases', count(*),
        'withConfirmedOutcome', count(outcome),
        'outcomes', jsonb_build_object('HEALED', count(*) FILTER (WHERE outcome = 'HEALED'), 'IMPROVING', count(*) FILTER (WHERE outcome = 'IMPROVING'),
                                       'NO_CHANGE', count(*) FILTER (WHERE outcome = 'NO_CHANGE'), 'WORSENED', count(*) FILTER (WHERE outcome = 'WORSENED'),
                                       'REFERRED', count(*) FILTER (WHERE outcome = 'REFERRED'), 'LOST_TO_FOLLOW_UP', count(*) FILTER (WHERE outcome = 'LOST_TO_FOLLOW_UP')),
        'medianDaysToConfirmedHealed', percentile_cont(0.5) WITHIN GROUP (ORDER BY (outcome_on - day1 + 1)) FILTER (WHERE outcome = 'HEALED' AND day1 IS NOT NULL),
        'withOtherTreatments', count(*) FILTER (WHERE other_treatment),
        'followUpCompleteness', CASE WHEN sum(due) > 0 THEN round(sum(met)::numeric / sum(due), 2) END,
        'missing', jsonb_build_object('outcome', count(*) - count(outcome), 'photos', count(*) FILTER (WHERE day1 IS NULL), 'productStart', count(*) FILTER (WHERE product <> 'NONE_RECORDED' AND started IS NULL))
      ) END AS g
    FROM rows GROUP BY category, product, product_name) s;
  RETURN v_out;
END $$;

-- ------------------------------------------------------------------ 7. registry overview (counts only)
CREATE FUNCTION app.wound_registry_overview() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_test boolean := app.is_review_account();
BEGIN
  IF NOT app.has_permission('wound.registry.read') THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  RETURN (
    WITH c AS (SELECT * FROM app.wound_cases WHERE test_data = v_test),
         i AS (SELECT i.* FROM app.wound_images i JOIN c ON c.id = i.case_id WHERE i.status = 'STORED'),
         pts AS (SELECT DISTINCT patient_id FROM c),
         first AS (SELECT case_id, app.wound_local_date(min(captured_at)) AS day1 FROM i GROUP BY case_id),
         due AS (SELECT c.id, count(*) AS due,
                        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM i WHERE i.case_id = c.id AND abs(app.wound_local_date(i.captured_at) - (f.day1 + d - 1)) <= 1)) AS met
                   FROM c JOIN first f ON f.case_id = c.id CROSS JOIN LATERAL unnest(c.follow_up_days) d
                  WHERE f.day1 + d - 1 <= app.wound_today() GROUP BY c.id)
    SELECT jsonb_build_object(
      'testData', v_test,
      'cases', (SELECT count(*) FROM c),
      'images', (SELECT count(*) FROM i),
      'profiles', (SELECT count(*) FROM pts),
      'consents', jsonb_build_object(
        'scan', (SELECT count(*) FROM pts WHERE app.wound_consent_active(patient_id, 'SCAN')),
        'research', (SELECT count(*) FROM pts WHERE app.wound_consent_active(patient_id, 'RESEARCH')),
        'presentation', (SELECT count(*) FROM pts WHERE app.wound_consent_active(patient_id, 'PRESENTATION'))),
      'clinicallyReviewed', (SELECT count(*) FROM c WHERE clinical_category IS NOT NULL),
      'withConfirmedOutcome', (SELECT count(*) FROM c WHERE outcome IS NOT NULL),
      'presentationEligible', (SELECT count(*) FROM c WHERE app.wound_presentation_eligible(c.id)),
      'byReportedCategory', coalesce((SELECT jsonb_object_agg(reported_category, n) FROM (SELECT reported_category, count(*) n FROM c GROUP BY 1) x), '{}'::jsonb),
      'byClinicalCategory', coalesce((SELECT jsonb_object_agg(clinical_category, n) FROM (SELECT clinical_category, count(*) n FROM c WHERE clinical_category IS NOT NULL GROUP BY 1) x), '{}'::jsonb),
      'outcomes', coalesce((SELECT jsonb_object_agg(outcome, n) FROM (SELECT outcome, count(*) n FROM c WHERE outcome IS NOT NULL GROUP BY 1) x), '{}'::jsonb),
      'followUpCompleteness', (SELECT CASE WHEN sum(due) > 0 THEN round(sum(met)::numeric / sum(due), 2) END FROM due),
      'datasets', coalesce((SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM app.wound_research_datasets WHERE test_data = v_test GROUP BY 1) x), '{}'::jsonb),
      'presentations', coalesce((SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM app.wound_presentation_cases WHERE test_data = v_test GROUP BY 1) x), '{}'::jsonb),
      'presentationExports', (SELECT count(*) FROM app.wound_presentation_exports WHERE test_data = v_test),
      'researchExports', (SELECT count(*) FROM app.wound_research_exports e JOIN app.wound_research_datasets d ON d.id = e.dataset_id WHERE d.test_data = v_test),
      'storagePurgePending', (SELECT count(*) FROM app.storage_purge_queue),
      'flags', (SELECT jsonb_object_agg(key, enabled) FROM app.feature_flags WHERE key LIKE 'wound.%' OR key = 'ai.wound_assessment'),
      'consentVersions', (SELECT value FROM app.settings WHERE key = 'wound.consent_versions'))
  );
END $$;

-- ------------------------------------------------------------------ media access (signed links)
/*
 * The storage key of a photo, if the CALLER may see it now. Called when a link is minted (with
 * audit) and again when it is fetched (no second audit entry).
 *   vault        — the profile's family access or a live clinician share; original or derivative.
 *   research     — research staff: the research copy of an included item (researchers: accepted items).
 *   presentation — presentation approvers: the derivative of a photo of an eligible candidate case or
 *                  of a presentation in progress. Never an original.
 */
CREATE FUNCTION app.wound_media_key(p_kind text, p_id uuid, p_variant text, p_audit boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_img app.wound_images;
  v_key text;
  v_patient uuid;
  v_via text;
BEGIN
  IF p_kind = 'vault' THEN
    SELECT * INTO v_img FROM app.wound_images WHERE id = p_id AND status = 'STORED';
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF app.can_view_patient(v_img.patient_id) THEN v_via := 'PROFILE_ACCESS';
    ELSIF app.has_care_wound_access(v_img.patient_id) THEN v_via := 'CLINICIAN_SHARE';
    ELSE RETURN NULL; END IF;
    v_key := CASE WHEN p_variant = 'original' THEN v_img.original_key ELSE v_img.derived_key END;
    v_patient := v_img.patient_id;
  ELSIF p_kind = 'research' THEN
    IF p_variant <> 'derived' THEN RETURN NULL; END IF;
    SELECT ri.storage_key INTO v_key FROM app.wound_research_images ri
      JOIN app.wound_research_items it ON it.id = ri.item_id JOIN app.wound_research_datasets d ON d.id = it.dataset_id
     WHERE ri.id = p_id AND ri.status = 'READY' AND it.status = 'INCLUDED' AND d.status <> 'RETIRED'
       AND d.test_data = app.is_review_account() AND app.wound_feature_available('wound.research', d.test_data)
       AND (app.has_permission('wound.research.review') OR (app.has_permission('wound.research.access') AND it.quality_status = 'ACCEPTED'));
    IF v_key IS NULL THEN RETURN NULL; END IF;
    v_via := 'RESEARCH';
  ELSIF p_kind = 'presentation' THEN
    IF p_variant <> 'derived' OR NOT app.has_permission('wound.presentation.manage') THEN RETURN NULL; END IF;
    SELECT * INTO v_img FROM app.wound_images WHERE id = p_id AND status = 'STORED';
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF NOT EXISTS (SELECT 1 FROM app.wound_cases c WHERE c.id = v_img.case_id AND c.test_data = app.is_review_account()
                     AND app.wound_feature_available('wound.presentations', c.test_data)
                     AND (app.wound_presentation_eligible(c.id)
                          OR EXISTS (SELECT 1 FROM app.wound_presentation_cases pc WHERE pc.case_id = c.id AND pc.status IN ('NOMINATED', 'AWAITING_PATIENT', 'PATIENT_APPROVED', 'APPROVED')))) THEN
      RETURN NULL;
    END IF;
    v_key := v_img.derived_key;
    v_patient := v_img.patient_id;
    v_via := 'PRESENTATION_REVIEW';
  ELSE
    RETURN NULL;
  END IF;
  IF p_audit THEN
    PERFORM app.write_audit('wound.image.view', CASE WHEN p_kind = 'research' THEN 'wound_research_image' ELSE 'wound_image' END, p_id::text, v_patient,
      jsonb_build_object('variant', p_variant, 'via', v_via));
  END IF;
  RETURN v_key;
END $$;

-- ------------------------------------------------------------------ maintenance (system context)
-- Unfinished uploads, unfinished research copies, datasets past retention, presentations past validity.
CREATE FUNCTION app.wound_maintenance() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_uploads int;
  v_copies int;
  v_retired int := 0;
  v_expired int;
  d record;
BEGIN
  IF app.current_user_id() IS NOT NULL THEN RAISE EXCEPTION 'SYSTEM_ONLY' USING ERRCODE = '42501'; END IF;
  WITH x AS (DELETE FROM app.wound_images WHERE status = 'PENDING' AND created_at < clock_timestamp() - interval '1 hour' RETURNING 1) SELECT count(*) INTO v_uploads FROM x;
  WITH x AS (DELETE FROM app.wound_research_images WHERE status = 'PENDING' AND created_at < clock_timestamp() - interval '1 hour' RETURNING 1) SELECT count(*) INTO v_copies FROM x;
  FOR d IN SELECT id FROM app.wound_research_datasets WHERE status = 'FROZEN' AND retention_until < current_date LOOP
    PERFORM app.wound_research_dataset_retire_internal(d.id, 'RETENTION_ENDED');
    v_retired := v_retired + 1;
  END LOOP;
  WITH x AS (UPDATE app.wound_presentation_cases SET status = 'WITHDRAWN', closed_reason = 'VALIDITY_ENDED', closed_at = clock_timestamp()
              WHERE status IN ('AWAITING_PATIENT', 'PATIENT_APPROVED', 'APPROVED') AND valid_until < current_date RETURNING 1) SELECT count(*) INTO v_expired FROM x;
  RETURN jsonb_build_object('abandonedUploads', v_uploads, 'abandonedResearchCopies', v_copies, 'retiredDatasets', v_retired, 'expiredPresentations', v_expired);
END $$;

-- ------------------------------------------------------------------ grants
REVOKE ALL ON FUNCTION app.wound_local_date(timestamptz), app.wound_today() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.wound_local_date(timestamptz), app.wound_today() TO ghayarly_app;
REVOKE ALL ON FUNCTION app.user_roles_wound_guard(), app.has_care_wound_access(uuid), app.care_share_set_wounds(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.has_care_wound_access(uuid), app.care_share_set_wounds(uuid, boolean) TO ghayarly_app;
REVOKE ALL ON FUNCTION
  app.is_internal_test_user(), app.patient_is_test(uuid), app.wound_feature_available(text, boolean), app.wound_consent_version(text),
  app.wound_consent_latest(uuid, text), app.wound_consent_active(uuid, text), app.wound_consent_scope(uuid, text),
  app.wound_research_covers(uuid, text, text), app.wound_presentation_covers(uuid, text, text), app.wound_consent_basis(uuid, text),
  app.wound_consent_record(uuid, text, text, text, jsonb, text), app.wound_cases_audit(), app.wound_images_audit(),
  app.wound_treatments_product_guard(), app.wound_image_register(uuid, uuid, text, int, text, text, int, int, int, int, timestamptz, text, text[], jsonb, text),
  app.wound_image_commit(uuid), app.wound_image_abort(uuid), app.wound_case_confirm(uuid, text, text), app.wound_case_outcome(uuid, text, date),
  app.wound_images_purge(), app.storage_purge_claim(int), app.storage_purge_done(text[], text[], text), app.wound_pseudonym(uuid, uuid),
  app.wound_research_images_purge(), app.wound_case_snapshot(uuid), app.wound_research_dataset_for_update(uuid),
  app.wound_research_dataset_create(text, text, text, text, jsonb), app.wound_research_dataset_build(uuid), app.wound_research_images_settle(uuid[], text[], uuid[]),
  app.wound_research_item_review(uuid, text, text), app.wound_research_dataset_freeze(uuid, text, date), app.wound_research_dataset_new_version(uuid),
  app.wound_research_dataset_retire_internal(uuid, text), app.wound_research_dataset_retire(uuid), app.wound_research_export_manifest(uuid),
  app.wound_presentation_images_removed(), app.wound_text_identifies(uuid, text), app.wound_presentation_require(uuid), app.wound_presentation_eligible(uuid),
  app.wound_presentation_candidates(), app.wound_presentation_case_images(uuid), app.wound_presentation_nominate(uuid), app.wound_presentation_fingerprint(uuid),
  app.wound_presentation_prepare(uuid, text, text, text, text, text, text, date, jsonb), app.wound_presentation_decide(uuid, text, text),
  app.wound_presentation_approve(uuid, jsonb), app.wound_presentation_reject(uuid, text), app.wound_presentation_withdraw(uuid),
  app.wound_presentation_export_data(uuid), app.wound_presentation_export_record(uuid, text, text), app.wound_enforce_permissions(uuid),
  app.wound_research_item_withdraw(uuid, text), app.wound_cases_before_delete(), app.wound_delete_all(uuid), app.wound_similar_cases(uuid, int),
  app.wound_product_outcomes(), app.wound_registry_overview(), app.wound_media_key(text, uuid, text, boolean), app.wound_maintenance()
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app.is_internal_test_user(), app.patient_is_test(uuid), app.wound_feature_available(text, boolean), app.wound_consent_version(text),
  app.wound_consent_active(uuid, text), app.wound_consent_scope(uuid, text), app.wound_consent_basis(uuid, text),
  app.wound_consent_record(uuid, text, text, text, jsonb, text),
  app.wound_image_register(uuid, uuid, text, int, text, text, int, int, int, int, timestamptz, text, text[], jsonb, text),
  app.wound_image_commit(uuid), app.wound_image_abort(uuid), app.wound_case_confirm(uuid, text, text), app.wound_case_outcome(uuid, text, date),
  app.storage_purge_claim(int), app.storage_purge_done(text[], text[], text),
  app.wound_research_dataset_create(text, text, text, text, jsonb), app.wound_research_dataset_build(uuid), app.wound_research_images_settle(uuid[], text[], uuid[]),
  app.wound_research_item_review(uuid, text, text), app.wound_research_dataset_freeze(uuid, text, date), app.wound_research_dataset_new_version(uuid),
  app.wound_research_dataset_retire(uuid), app.wound_research_export_manifest(uuid),
  app.wound_presentation_eligible(uuid), app.wound_presentation_candidates(), app.wound_presentation_case_images(uuid), app.wound_presentation_nominate(uuid),
  app.wound_presentation_prepare(uuid, text, text, text, text, text, text, date, jsonb), app.wound_presentation_decide(uuid, text, text),
  app.wound_presentation_approve(uuid, jsonb), app.wound_presentation_reject(uuid, text), app.wound_presentation_withdraw(uuid),
  app.wound_presentation_export_data(uuid), app.wound_presentation_export_record(uuid, text, text),
  app.wound_delete_all(uuid), app.wound_similar_cases(uuid, int), app.wound_product_outcomes(), app.wound_registry_overview(),
  app.wound_media_key(text, uuid, text, boolean), app.wound_maintenance()
TO ghayarly_app;
