-- 0003 — Patients, family access (consent / guardianship / delegation), health baseline.
--
-- A `patient` is a person whose health is managed in the app. An account may manage several
-- patients (self, parents, children…) through `patient_access` grants. Being a relative does
-- NOT grant access by itself: every grant records its legal basis and an explicit attestation.

CREATE TYPE app.relationship AS ENUM ('SELF', 'MOTHER', 'FATHER', 'SPOUSE', 'CHILD', 'SIBLING', 'GRANDPARENT', 'OTHER');
CREATE TYPE app.access_level AS ENUM ('OWNER', 'GUARDIAN', 'CAREGIVER');
CREATE TYPE app.consent_basis AS ENUM ('SELF', 'GUARDIAN_OF_MINOR', 'ADULT_CONSENT_ATTESTED', 'LEGAL_AUTHORITY_ATTESTED');
CREATE TYPE app.access_status AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE app.health_entry_kind AS ENUM ('ALLERGY', 'CONDITION', 'MEDICATION', 'SURGERY');
CREATE TYPE app.record_status AS ENUM ('ACTIVE', 'ENTERED_IN_ERROR');

CREATE TABLE app.patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  date_of_birth date NOT NULL CHECK (date_of_birth > DATE '1900-01-01'),
  sex app.sex NOT NULL,
  blood_type app.blood_type NOT NULL DEFAULT 'UNKNOWN',
  blood_type_provenance app.provenance,
  governorate app.governorate,
  city text CHECK (city IS NULL OR length(city) <= 80),
  phone text CHECK (phone IS NULL OR phone ~ '^\+201[0125][0-9]{8}$'),
  emergency_contact_name text CHECK (emergency_contact_name IS NULL OR length(emergency_contact_name) <= 80),
  emergency_contact_phone text CHECK (emergency_contact_phone IS NULL OR emergency_contact_phone ~ '^\+201[0125][0-9]{8}$'),
  emergency_contact_relation text CHECK (emergency_contact_relation IS NULL OR length(emergency_contact_relation) <= 40),
  baseline_completed_at timestamptz,
  -- The person themself, when they hold an account (enables claiming a caregiver-created profile).
  linked_user_id text UNIQUE REFERENCES auth."user" ("id") ON DELETE SET NULL,
  created_by_user_id text NOT NULL REFERENCES auth."user" ("id"),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blood_type_has_provenance CHECK (blood_type = 'UNKNOWN' OR blood_type_provenance IS NOT NULL)
);
CREATE TRIGGER patients_touch BEFORE UPDATE ON app.patients FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE app.patient_access (
  patient_id uuid NOT NULL REFERENCES app.patients (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE,
  relationship app.relationship NOT NULL,
  access_level app.access_level NOT NULL,
  consent_basis app.consent_basis NOT NULL,
  consent_statement_version text NOT NULL,
  consent_attested_at timestamptz NOT NULL DEFAULT now(),
  status app.access_status NOT NULL DEFAULT 'ACTIVE',
  granted_by_user_id text NOT NULL REFERENCES auth."user" ("id"),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_user_id text REFERENCES auth."user" ("id"),
  PRIMARY KEY (patient_id, user_id),
  CONSTRAINT self_is_owner CHECK ((relationship = 'SELF') = (access_level = 'OWNER' AND consent_basis = 'SELF')),
  CONSTRAINT revoked_consistency CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX patient_access_one_self ON app.patient_access (user_id) WHERE relationship = 'SELF' AND status = 'ACTIVE';
CREATE INDEX patient_access_user_idx ON app.patient_access (user_id) WHERE status = 'ACTIVE';

-- ------------------------------------------------------------------ access helpers
CREATE FUNCTION app.can_view_patient(p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.patient_access
    WHERE patient_id = p_patient AND user_id = app.current_user_id() AND status = 'ACTIVE'
  )
$$;

-- Editing the record: any active grant (owner, guardian, consented caregiver).
CREATE FUNCTION app.can_edit_patient(p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT app.can_view_patient(p_patient)
$$;

-- Administering access (granting/revoking others): the owner, a guardian of a minor, or —
-- only while the adult has not claimed their profile — the consented caregiver.
CREATE FUNCTION app.can_administer_patient(p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.patient_access pa JOIN app.patients p ON p.id = pa.patient_id
    WHERE pa.patient_id = p_patient AND pa.user_id = app.current_user_id() AND pa.status = 'ACTIVE'
      AND (pa.access_level IN ('OWNER', 'GUARDIAN') OR (pa.access_level = 'CAREGIVER' AND p.linked_user_id IS NULL))
  )
$$;

-- ------------------------------------------------------------------ policies: patients
ALTER TABLE app.patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY patients_select ON app.patients FOR SELECT TO ghayarly_app
  USING (app.can_view_patient(id) AND (NOT is_demo OR app.demo_visible()));
CREATE POLICY patients_update ON app.patients FOR UPDATE TO ghayarly_app
  USING (app.can_edit_patient(id)) WITH CHECK (app.can_edit_patient(id));
-- No INSERT/DELETE policy: creation goes through app.create_patient_profile(); records are never hard-deleted.
GRANT SELECT ON app.patients TO ghayarly_app;
GRANT UPDATE (display_name, date_of_birth, sex, blood_type, governorate, city, phone, emergency_contact_name,
  emergency_contact_phone, emergency_contact_relation, baseline_completed_at) ON app.patients TO ghayarly_app;

-- Blood type entered through the app is always patient/caregiver-reported. Promotion to
-- PROFESSIONALLY_VERIFIED is reserved for verified clinicians in an active care relationship (M3).
-- SECURITY INVOKER on purpose: `current_user` must be the connected role.
CREATE FUNCTION app.patients_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  IF current_user = 'ghayarly_app' THEN
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
CREATE TRIGGER patients_guard BEFORE UPDATE ON app.patients FOR EACH ROW EXECUTE FUNCTION app.patients_guard();

-- ------------------------------------------------------------------ policies: patient_access
ALTER TABLE app.patient_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY patient_access_select ON app.patient_access FOR SELECT TO ghayarly_app
  USING (user_id = app.current_user_id() OR app.can_administer_patient(patient_id));
-- Mutations only through SECURITY DEFINER functions below (validated + audited).
GRANT SELECT ON app.patient_access TO ghayarly_app;

CREATE FUNCTION app.create_patient_profile(
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
  IF p_date_of_birth > current_date THEN RAISE EXCEPTION 'INVALID_DATE_OF_BIRTH' USING ERRCODE = 'P0001'; END IF;
  IF coalesce(length(trim(p_statement_version)), 0) = 0 THEN RAISE EXCEPTION 'CONSENT_STATEMENT_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  v_age := extract(year FROM age(current_date, p_date_of_birth))::int;

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
    SELECT (value #>> '{}')::int INTO v_limit FROM app.settings WHERE key = 'family.max_managed_profiles';
    IF (SELECT count(*) FROM app.patient_access WHERE user_id = v_user AND status = 'ACTIVE' AND relationship <> 'SELF') >= coalesce(v_limit, 8) THEN
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

CREATE FUNCTION app.revoke_patient_access(p_patient uuid, p_user text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_actor text := app.current_user_id();
  v_target app.patient_access;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_target FROM app.patient_access WHERE patient_id = p_patient AND user_id = p_user AND status = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_GRANT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_target.access_level = 'OWNER' THEN RAISE EXCEPTION 'CANNOT_REVOKE_OWNER' USING ERRCODE = '42501'; END IF;
  -- Anyone may leave a profile; otherwise the actor must administer it.
  IF p_user <> v_actor AND NOT app.can_administer_patient(p_patient) THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  UPDATE app.patient_access SET status = 'REVOKED', revoked_at = now(), revoked_by_user_id = v_actor
  WHERE patient_id = p_patient AND user_id = p_user;
  PERFORM app.write_audit('patient.access.revoked', 'patient', p_patient::text, p_patient, jsonb_build_object('revokedUserId', p_user));
END $$;

-- ------------------------------------------------------------------ health baseline entries
CREATE TABLE app.patient_health_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES app.patients (id) ON DELETE CASCADE,
  kind app.health_entry_kind NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  detail text CHECK (detail IS NULL OR length(detail) <= 500),
  note text CHECK (note IS NULL OR length(note) <= 200),
  provenance app.provenance NOT NULL,
  recorded_by_user_id text NOT NULL REFERENCES auth."user" ("id"),
  verified_by_user_id text REFERENCES auth."user" ("id"),
  verified_at timestamptz,
  status app.record_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verified_consistency CHECK ((provenance = 'PROFESSIONALLY_VERIFIED') = (verified_by_user_id IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX patient_health_entries_patient_idx ON app.patient_health_entries (patient_id, kind) WHERE status = 'ACTIVE';
CREATE TRIGGER patient_health_entries_touch BEFORE UPDATE ON app.patient_health_entries FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE app.patient_health_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY health_entries_select ON app.patient_health_entries FOR SELECT TO ghayarly_app
  USING (app.can_view_patient(patient_id));
CREATE POLICY health_entries_insert ON app.patient_health_entries FOR INSERT TO ghayarly_app
  WITH CHECK (
    app.can_edit_patient(patient_id)
    AND recorded_by_user_id = app.current_user_id()
    AND provenance IN ('PATIENT_REPORTED', 'CAREGIVER_REPORTED')
    AND verified_by_user_id IS NULL AND status = 'ACTIVE'
  );
-- Entries are never deleted: they can be marked ENTERED_IN_ERROR (FHIR semantics).
CREATE POLICY health_entries_update ON app.patient_health_entries FOR UPDATE TO ghayarly_app
  USING (app.can_edit_patient(patient_id) AND provenance <> 'PROFESSIONALLY_VERIFIED')
  WITH CHECK (app.can_edit_patient(patient_id));
GRANT SELECT ON app.patient_health_entries TO ghayarly_app;
GRANT INSERT ON app.patient_health_entries TO ghayarly_app;
GRANT UPDATE (title, detail, note, status, updated_at) ON app.patient_health_entries TO ghayarly_app;

-- Reported provenance is derived, not chosen by the client: the profile's own account holder
-- reports as PATIENT, anyone else as CAREGIVER.
CREATE FUNCTION app.health_entries_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  IF current_user = 'ghayarly_app' THEN
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
CREATE TRIGGER health_entries_guard BEFORE INSERT ON app.patient_health_entries FOR EACH ROW EXECUTE FUNCTION app.health_entries_guard();

GRANT EXECUTE ON FUNCTION app.can_view_patient(uuid), app.can_edit_patient(uuid), app.can_administer_patient(uuid),
  app.create_patient_profile(text, date, app.sex, app.relationship, app.consent_basis, text),
  app.revoke_patient_access(uuid, text) TO ghayarly_app;
