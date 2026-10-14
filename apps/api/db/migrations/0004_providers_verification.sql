-- 0004 — Provider profiles, credentials, verification workflow, capacity, working hours.
--
-- A provider is invisible to patients until a CLINICAL_REVIEWER/ADMIN approves them. The
-- verification state machine is enforced here (trigger), mirrored in
-- packages/shared/src/verification.ts for UI affordances.

CREATE TYPE app.provider_type AS ENUM ('DOCTOR', 'NURSE');
CREATE TYPE app.verification_status AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED');
CREATE TYPE app.availability_status AS ENUM (
  'ACCEPTING_NEW_PATIENTS', 'LIMITED_AVAILABILITY', 'EXISTING_PATIENTS_ONLY', 'FULLY_BOOKED', 'AWAY',
  'AVAILABLE_NOW', 'AVAILABLE_TODAY', 'SCHEDULED_ONLY');
CREATE TYPE app.credential_kind AS ENUM ('NATIONAL_ID', 'MEDICAL_LICENSE', 'MEDICAL_DEGREE', 'SPECIALTY_BOARD', 'NURSING_LICENSE', 'NURSING_DEGREE', 'CERTIFICATION');
CREATE TYPE app.credential_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE app.specialty AS ENUM ('GENERAL_PRACTICE', 'INTERNAL_MEDICINE', 'GENERAL_SURGERY', 'PLASTIC_SURGERY', 'VASCULAR_SURGERY',
  'DERMATOLOGY', 'ENDOCRINOLOGY', 'GERIATRICS', 'ORTHOPEDICS', 'CARDIOLOGY', 'PEDIATRICS', 'FAMILY_MEDICINE');

CREATE TABLE app.provider_profiles (
  user_id text PRIMARY KEY REFERENCES auth."user" ("id") ON DELETE CASCADE,
  provider_type app.provider_type NOT NULL,
  display_name_ar text NOT NULL CHECK (length(display_name_ar) BETWEEN 1 AND 80),
  display_name_en text NOT NULL CHECK (length(display_name_en) BETWEEN 1 AND 80),
  gender app.gender NOT NULL,
  specialty app.specialty,
  subspecialty text CHECK (subspecialty IS NULL OR length(subspecialty) <= 80),
  years_experience int NOT NULL CHECK (years_experience BETWEEN 0 AND 60),
  bio_ar text CHECK (bio_ar IS NULL OR length(bio_ar) <= 600),
  bio_en text CHECK (bio_en IS NULL OR length(bio_en) <= 600),
  current_affiliation text CHECK (current_affiliation IS NULL OR length(current_affiliation) <= 120),
  previous_experience text CHECK (previous_experience IS NULL OR length(previous_experience) <= 600),
  skills text[] NOT NULL DEFAULT '{}' CHECK (cardinality(skills) <= 20),
  governorate app.governorate NOT NULL,
  city text NOT NULL CHECK (length(city) BETWEEN 1 AND 80),
  -- Approximate service-area centroid only. Never a home address.
  service_area geography(Point, 4326),
  fee_piasters int CHECK (fee_piasters IS NULL OR fee_piasters BETWEEN 0 AND 10000000),
  verification_status app.verification_status NOT NULL DEFAULT 'DRAFT',
  verification_note text CHECK (verification_note IS NULL OR length(verification_note) <= 1000),
  submitted_at timestamptz,
  verified_at timestamptz,
  verified_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  availability_status app.availability_status NOT NULL,
  max_daily_appointments int NOT NULL DEFAULT 8 CHECK (max_daily_appointments BETWEEN 0 AND 80),
  service_radius_km int NOT NULL DEFAULT 10 CHECK (service_radius_km BETWEEN 1 AND 100),
  away_until date,
  temporarily_unavailable boolean NOT NULL DEFAULT false,
  -- Maintained by the booking system (Milestone 2); never writable by providers.
  completed_visits int NOT NULL DEFAULT 0 CHECK (completed_visits >= 0),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT doctor_has_specialty CHECK (provider_type <> 'DOCTOR' OR specialty IS NOT NULL),
  CONSTRAINT availability_matches_type CHECK (
    (provider_type = 'DOCTOR' AND availability_status IN ('ACCEPTING_NEW_PATIENTS', 'LIMITED_AVAILABILITY', 'EXISTING_PATIENTS_ONLY', 'FULLY_BOOKED', 'AWAY'))
    OR (provider_type = 'NURSE' AND availability_status IN ('AVAILABLE_NOW', 'AVAILABLE_TODAY', 'SCHEDULED_ONLY', 'FULLY_BOOKED', 'AWAY')))
);
CREATE INDEX provider_profiles_discovery_idx ON app.provider_profiles (provider_type, verification_status, governorate);
CREATE INDEX provider_profiles_area_gix ON app.provider_profiles USING gist (service_area);
CREATE TRIGGER provider_profiles_touch BEFORE UPDATE ON app.provider_profiles FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE app.provider_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id text NOT NULL REFERENCES app.provider_profiles (user_id) ON DELETE CASCADE,
  kind app.credential_kind NOT NULL,
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 120),
  identifier text NOT NULL CHECK (length(identifier) BETWEEN 1 AND 80),
  issued_on date,
  expires_on date,
  -- Private object-storage key of the uploaded document (secure storage arrives with M2/M3).
  document_object_key text,
  status app.credential_status NOT NULL DEFAULT 'PENDING',
  review_note text CHECK (review_note IS NULL OR length(review_note) <= 1000),
  reviewed_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credential_dates CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on > issued_on)
);
CREATE INDEX provider_credentials_provider_idx ON app.provider_credentials (provider_user_id);
CREATE TRIGGER provider_credentials_touch BEFORE UPDATE ON app.provider_credentials FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE app.provider_verification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id text NOT NULL REFERENCES app.provider_profiles (user_id) ON DELETE CASCADE,
  actor_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  from_status app.verification_status,
  to_status app.verification_status NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX provider_verification_events_idx ON app.provider_verification_events (provider_user_id, created_at DESC);

CREATE TABLE app.provider_working_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id text NOT NULL REFERENCES app.provider_profiles (user_id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute smallint NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute smallint NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  CONSTRAINT working_hours_order CHECK (end_minute > start_minute)
);
CREATE INDEX provider_working_hours_idx ON app.provider_working_hours (provider_user_id, weekday);

-- ------------------------------------------------------------------ helpers
-- Mirrors REQUIRED_CREDENTIALS in packages/shared/src/enums.ts.
CREATE FUNCTION app.required_credential_kinds(p_type app.provider_type) RETURNS app.credential_kind[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_type
    WHEN 'DOCTOR' THEN ARRAY['NATIONAL_ID', 'MEDICAL_LICENSE', 'MEDICAL_DEGREE']::app.credential_kind[]
    ELSE ARRAY['NATIONAL_ID', 'NURSING_LICENSE']::app.credential_kind[]
  END
$$;

CREATE FUNCTION app.provider_missing_credentials(p_user text, p_type app.provider_type, p_require_approved boolean)
RETURNS app.credential_kind[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce(array_agg(k), '{}')
  FROM unnest(app.required_credential_kinds(p_type)) AS k
  WHERE NOT EXISTS (
    SELECT 1 FROM app.provider_credentials c
    WHERE c.provider_user_id = p_user AND c.kind = k
      AND (CASE WHEN p_require_approved THEN c.status = 'APPROVED' ELSE c.status <> 'REJECTED' END)
  )
$$;

-- Verification history is written by an AFTER trigger running as the owner, so the app role
-- can never insert or forge history rows directly.
CREATE FUNCTION app.provider_profiles_log_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
    INSERT INTO app.provider_verification_events (provider_user_id, actor_user_id, from_status, to_status, note)
    VALUES (NEW.user_id, app.current_user_id(), OLD.verification_status, NEW.verification_status, NEW.verification_note);
    PERFORM app.write_audit('provider.verification.' || lower(NEW.verification_status::text), 'provider', NEW.user_id, NULL,
      jsonb_build_object('from', OLD.verification_status, 'to', NEW.verification_status, 'note', NEW.verification_note));
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION app.verification_transition_allowed(p_actor text, p_from app.verification_status, p_to app.verification_status)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_actor
    WHEN 'PROVIDER' THEN p_from IN ('DRAFT', 'CHANGES_REQUESTED', 'REJECTED') AND p_to = 'SUBMITTED'
    WHEN 'REVIEWER' THEN (p_from = 'SUBMITTED' AND p_to IN ('UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED'))
                      OR (p_from = 'UNDER_REVIEW' AND p_to IN ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED'))
    WHEN 'ADMIN' THEN (p_from = 'SUBMITTED' AND p_to IN ('UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED'))
                   OR (p_from = 'UNDER_REVIEW' AND p_to IN ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED'))
                   OR (p_from = 'APPROVED' AND p_to = 'SUSPENDED')
                   OR (p_from = 'SUSPENDED' AND p_to = 'APPROVED')
    ELSE false
  END
$$;

-- ------------------------------------------------------------------ guard: provider_profiles
-- SECURITY INVOKER: `current_user` identifies the connected role. Owner (migrations/seed) bypasses.
CREATE FUNCTION app.provider_profiles_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE
  v_actor text := app.current_user_id();
  v_kind text;
  v_missing app.credential_kind[];
BEGIN
  IF current_user <> 'ghayarly_app' THEN RETURN NEW; END IF;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501'; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id <> v_actor THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
    NEW.verification_status := 'DRAFT';
    NEW.verification_note := NULL;
    NEW.submitted_at := NULL;
    NEW.verified_at := NULL;
    NEW.verified_by_user_id := NULL;
    NEW.completed_visits := 0;
    NEW.is_demo := false;
    RETURN NEW;
  END IF;

  IF NEW.provider_type <> OLD.provider_type THEN RAISE EXCEPTION 'PROVIDER_TYPE_IMMUTABLE' USING ERRCODE = 'P0001'; END IF;
  IF NEW.completed_visits <> OLD.completed_visits OR NEW.is_demo <> OLD.is_demo
     OR NEW.verified_at IS DISTINCT FROM OLD.verified_at OR NEW.verified_by_user_id IS DISTINCT FROM OLD.verified_by_user_id
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'PROTECTED_FIELD' USING ERRCODE = '42501';
  END IF;

  IF NEW.user_id <> v_actor THEN
    -- Staff may only change verification fields (and, with capacity permission, capacity fields).
    IF (NEW.display_name_ar, NEW.display_name_en, NEW.gender, NEW.specialty, NEW.subspecialty, NEW.years_experience,
        NEW.bio_ar, NEW.bio_en, NEW.current_affiliation, NEW.previous_experience, NEW.skills, NEW.governorate, NEW.city,
        NEW.fee_piasters, NEW.service_area::text)
       IS DISTINCT FROM
       (OLD.display_name_ar, OLD.display_name_en, OLD.gender, OLD.specialty, OLD.subspecialty, OLD.years_experience,
        OLD.bio_ar, OLD.bio_en, OLD.current_affiliation, OLD.previous_experience, OLD.skills, OLD.governorate, OLD.city,
        OLD.fee_piasters, OLD.service_area::text) THEN
      RAISE EXCEPTION 'STAFF_CANNOT_EDIT_PROFESSIONAL_PROFILE' USING ERRCODE = '42501';
    END IF;
    IF (NEW.availability_status, NEW.max_daily_appointments, NEW.service_radius_km, NEW.away_until, NEW.temporarily_unavailable)
       IS DISTINCT FROM (OLD.availability_status, OLD.max_daily_appointments, OLD.service_radius_km, OLD.away_until, OLD.temporarily_unavailable)
       AND NOT app.has_permission('provider.capacity.manage_any') THEN
      RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
    IF NEW.user_id = v_actor THEN
      v_kind := 'PROVIDER';
    ELSIF app.has_role('ADMIN') THEN
      v_kind := 'ADMIN';
    ELSIF app.has_permission('provider.verification.decide') THEN
      v_kind := 'REVIEWER';
    ELSE
      RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
    END IF;

    IF NOT app.verification_transition_allowed(v_kind, OLD.verification_status, NEW.verification_status) THEN
      RAISE EXCEPTION 'INVALID_VERIFICATION_TRANSITION' USING ERRCODE = 'P0001';
    END IF;

    IF NEW.verification_status = 'SUBMITTED' THEN
      v_missing := app.provider_missing_credentials(NEW.user_id, NEW.provider_type, false);
      IF cardinality(v_missing) > 0 THEN
        RAISE EXCEPTION 'REQUIRED_CREDENTIALS_MISSING' USING ERRCODE = 'P0001', DETAIL = array_to_string(v_missing, ',');
      END IF;
      NEW.submitted_at := now();
      NEW.verification_note := NULL;
    ELSIF NEW.verification_status = 'APPROVED' THEN
      v_missing := app.provider_missing_credentials(NEW.user_id, NEW.provider_type, true);
      IF cardinality(v_missing) > 0 THEN
        RAISE EXCEPTION 'REQUIRED_CREDENTIALS_NOT_APPROVED' USING ERRCODE = 'P0001', DETAIL = array_to_string(v_missing, ',');
      END IF;
      NEW.verified_at := now();
      NEW.verified_by_user_id := v_actor;
    ELSIF NEW.verification_status IN ('REJECTED', 'CHANGES_REQUESTED', 'SUSPENDED') THEN
      IF coalesce(length(trim(NEW.verification_note)), 0) = 0 THEN
        RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  ELSIF NEW.verification_note IS DISTINCT FROM OLD.verification_note THEN
    RAISE EXCEPTION 'PROTECTED_FIELD' USING ERRCODE = '42501';
  ELSIF NEW.user_id = v_actor AND OLD.verification_status = 'APPROVED'
        AND (NEW.specialty IS DISTINCT FROM OLD.specialty OR NEW.display_name_ar <> OLD.display_name_ar OR NEW.display_name_en <> OLD.display_name_en) THEN
    -- Material identity/specialty changes after approval send the profile back for review.
    NEW.verification_status := 'SUBMITTED';
    NEW.submitted_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER provider_profiles_guard BEFORE INSERT OR UPDATE ON app.provider_profiles
  FOR EACH ROW EXECUTE FUNCTION app.provider_profiles_guard();
CREATE TRIGGER provider_profiles_log_status AFTER UPDATE ON app.provider_profiles
  FOR EACH ROW EXECUTE FUNCTION app.provider_profiles_log_status();

-- ------------------------------------------------------------------ guard: provider_credentials
CREATE FUNCTION app.provider_credentials_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE
  v_actor text := app.current_user_id();
BEGIN
  IF current_user <> 'ghayarly_app' THEN RETURN coalesce(NEW, OLD); END IF;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501'; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.provider_user_id <> v_actor THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
    NEW.status := 'PENDING'; NEW.review_note := NULL; NEW.reviewed_by_user_id := NULL; NEW.reviewed_at := NULL;
    PERFORM app.write_audit('provider.credential.added', 'provider_credential', NEW.id::text, NULL, jsonb_build_object('kind', NEW.kind));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.provider_user_id <> v_actor OR OLD.status = 'APPROVED' THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
    PERFORM app.write_audit('provider.credential.removed', 'provider_credential', OLD.id::text, NULL, jsonb_build_object('kind', OLD.kind));
    RETURN OLD;
  END IF;

  IF NEW.provider_user_id <> OLD.provider_user_id OR NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'PROTECTED_FIELD' USING ERRCODE = '42501';
  END IF;

  IF OLD.provider_user_id = v_actor THEN
    -- Providers may correct details of non-approved credentials; this resets review.
    IF OLD.status = 'APPROVED' THEN RAISE EXCEPTION 'APPROVED_CREDENTIAL_LOCKED' USING ERRCODE = 'P0001'; END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'PENDING' THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
    NEW.status := 'PENDING'; NEW.review_note := NULL; NEW.reviewed_by_user_id := NULL; NEW.reviewed_at := NULL;
    RETURN NEW;
  END IF;

  IF NOT app.has_permission('provider.verification.decide') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF (NEW.issuer, NEW.identifier, NEW.issued_on, NEW.expires_on, NEW.document_object_key)
     IS DISTINCT FROM (OLD.issuer, OLD.identifier, OLD.issued_on, OLD.expires_on, OLD.document_object_key) THEN
    RAISE EXCEPTION 'STAFF_CANNOT_EDIT_CREDENTIAL' USING ERRCODE = '42501';
  END IF;
  IF NEW.status NOT IN ('APPROVED', 'REJECTED') THEN RAISE EXCEPTION 'INVALID_CREDENTIAL_DECISION' USING ERRCODE = 'P0001'; END IF;
  IF NEW.status = 'REJECTED' AND coalesce(length(trim(NEW.review_note)), 0) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  NEW.reviewed_by_user_id := v_actor;
  NEW.reviewed_at := now();
  PERFORM app.write_audit('provider.credential.' || lower(NEW.status::text), 'provider_credential', NEW.id::text, NULL,
    jsonb_build_object('kind', NEW.kind, 'provider', NEW.provider_user_id, 'note', NEW.review_note));
  RETURN NEW;
END $$;
CREATE TRIGGER provider_credentials_guard BEFORE INSERT OR UPDATE OR DELETE ON app.provider_credentials
  FOR EACH ROW EXECUTE FUNCTION app.provider_credentials_guard();

-- ------------------------------------------------------------------ policies
ALTER TABLE app.provider_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_profiles_select ON app.provider_profiles FOR SELECT TO ghayarly_app
  USING (
    user_id = app.current_user_id()
    OR (verification_status = 'APPROVED' AND (NOT is_demo OR app.demo_visible()))
    OR app.has_permission('provider.verification.review')
  );
CREATE POLICY provider_profiles_insert ON app.provider_profiles FOR INSERT TO ghayarly_app
  WITH CHECK (user_id = app.current_user_id() AND app.has_role(provider_type::text::app.role));
CREATE POLICY provider_profiles_update ON app.provider_profiles FOR UPDATE TO ghayarly_app
  USING (user_id = app.current_user_id() OR app.has_permission('provider.verification.decide') OR app.has_permission('provider.capacity.manage_any'))
  WITH CHECK (user_id = app.current_user_id() OR app.has_permission('provider.verification.decide') OR app.has_permission('provider.capacity.manage_any'));
GRANT SELECT, INSERT, UPDATE ON app.provider_profiles TO ghayarly_app;

ALTER TABLE app.provider_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_credentials_select ON app.provider_credentials FOR SELECT TO ghayarly_app
  USING (provider_user_id = app.current_user_id() OR app.has_permission('provider.verification.review'));
CREATE POLICY provider_credentials_insert ON app.provider_credentials FOR INSERT TO ghayarly_app
  WITH CHECK (provider_user_id = app.current_user_id());
CREATE POLICY provider_credentials_update ON app.provider_credentials FOR UPDATE TO ghayarly_app
  USING (provider_user_id = app.current_user_id() OR app.has_permission('provider.verification.decide'))
  WITH CHECK (provider_user_id = app.current_user_id() OR app.has_permission('provider.verification.decide'));
CREATE POLICY provider_credentials_delete ON app.provider_credentials FOR DELETE TO ghayarly_app
  USING (provider_user_id = app.current_user_id() AND status <> 'APPROVED');
GRANT SELECT, INSERT, UPDATE, DELETE ON app.provider_credentials TO ghayarly_app;

ALTER TABLE app.provider_verification_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_verification_events_select ON app.provider_verification_events FOR SELECT TO ghayarly_app
  USING (provider_user_id = app.current_user_id() OR app.has_permission('provider.verification.review'));
GRANT SELECT ON app.provider_verification_events TO ghayarly_app;

ALTER TABLE app.provider_working_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_working_hours_select ON app.provider_working_hours FOR SELECT TO ghayarly_app
  USING (
    provider_user_id = app.current_user_id()
    OR app.has_permission('provider.verification.review')
    OR EXISTS (SELECT 1 FROM app.provider_profiles p WHERE p.user_id = provider_user_id AND p.verification_status = 'APPROVED')
  );
CREATE POLICY provider_working_hours_write ON app.provider_working_hours FOR ALL TO ghayarly_app
  USING (provider_user_id = app.current_user_id()) WITH CHECK (provider_user_id = app.current_user_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON app.provider_working_hours TO ghayarly_app;

-- Patients may see THAT a credential is verified (kind, issuer, date) — never the licence number.
-- The view runs with its owner's rights on purpose, exposing exactly these columns.
CREATE VIEW app.public_provider_credentials WITH (security_barrier = true) AS
  SELECT c.provider_user_id, c.kind, c.issuer, c.reviewed_at AS verified_at
  FROM app.provider_credentials c
  JOIN app.provider_profiles p ON p.user_id = c.provider_user_id
  WHERE c.status = 'APPROVED' AND p.verification_status = 'APPROVED' AND (NOT p.is_demo OR app.demo_visible());
GRANT SELECT ON app.public_provider_credentials TO ghayarly_app;

-- write_audit attributes the row to app.current_user_id(); equivalent to the INSERT policy on audit_log.
GRANT EXECUTE ON FUNCTION app.write_audit(text, text, text, uuid, jsonb) TO ghayarly_app;
GRANT EXECUTE ON FUNCTION app.required_credential_kinds(app.provider_type),
  app.provider_missing_credentials(text, app.provider_type, boolean),
  app.verification_transition_allowed(text, app.verification_status, app.verification_status) TO ghayarly_app;
