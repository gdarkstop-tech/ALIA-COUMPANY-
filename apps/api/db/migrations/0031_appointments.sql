-- 0031 — Appointments: doctor consultations and nurse home visits (Phase 8 M2/M3, ADR 0021).
--
-- Every booking rule is enforced here, in SECURITY DEFINER functions, not in the API:
--   * a time can be requested only if it is one of the provider's real free slots (working hours in
--     Africa/Cairo, minus time off, other bookings, the daily cap, lead time and horizon) — nothing
--     is ever shown or accepted that the provider did not publish;
--   * two active bookings can never overlap for one provider or one patient (exclusion constraints),
--     whatever the API does or how many requests race;
--   * nobody is assigned automatically: a person chooses a provider, the provider accepts or declines;
--   * prices are snapshotted from the doctor's published offering or the catalogue's approved price.

CREATE EXTENSION IF NOT EXISTS btree_gist;

INSERT INTO app.feature_flags (key, enabled, risk, requires_regulatory_evidence, description) VALUES
  ('care.clinic_booking', false, 'MEDIUM', false, 'Requesting in-clinic consultations with verified doctors (confirmed by the doctor; paid at the clinic).')
ON CONFLICT (key) DO NOTHING;

CREATE FUNCTION app.flag_on(p_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce((SELECT enabled FROM app.feature_flags WHERE key = p_key), false)
$$;

CREATE TYPE app.appointment_kind AS ENUM ('DOCTOR_CLINIC', 'DOCTOR_HOME_VISIT', 'DOCTOR_ONLINE', 'NURSE_HOME_VISIT');
-- REQUESTED → CONFIRMED → (IN_PROGRESS) → COMPLETED; or DECLINED, CANCELLED, EXPIRED (not answered in
-- time), NO_SHOW (patient absent), VISIT_FAILED (home visit could not be carried out → incident).
CREATE TYPE app.appointment_status AS ENUM ('REQUESTED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED', 'NO_SHOW', 'VISIT_FAILED');

-- ------------------------------------------------------------------ doctor offerings
CREATE TABLE app.doctor_offerings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id text NOT NULL REFERENCES app.provider_profiles (user_id) ON DELETE CASCADE,
  kind app.appointment_kind NOT NULL CHECK (kind IN ('DOCTOR_CLINIC', 'DOCTOR_HOME_VISIT', 'DOCTOR_ONLINE')),
  duration_minutes int NOT NULL CHECK (duration_minutes IN (15, 20, 30, 45, 60, 90)),
  price_piasters int NOT NULL CHECK (price_piasters BETWEEN 0 AND 10000000),
  -- Public business address of the clinic (never a home address).
  clinic_address_ar text CHECK (clinic_address_ar IS NULL OR length(clinic_address_ar) BETWEEN 5 AND 300),
  clinic_address_en text CHECK (clinic_address_en IS NULL OR length(clinic_address_en) BETWEEN 5 AND 300),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_user_id, kind),
  CONSTRAINT clinic_has_address CHECK (kind <> 'DOCTOR_CLINIC' OR clinic_address_ar IS NOT NULL OR clinic_address_en IS NOT NULL)
);
CREATE TRIGGER doctor_offerings_touch BEFORE UPDATE ON app.doctor_offerings FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE FUNCTION app.doctor_offerings_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.provider_profiles WHERE user_id = NEW.provider_user_id AND provider_type = 'DOCTOR') THEN
    RAISE EXCEPTION 'DOCTORS_ONLY' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER doctor_offerings_guard BEFORE INSERT OR UPDATE ON app.doctor_offerings FOR EACH ROW EXECUTE FUNCTION app.doctor_offerings_guard();

ALTER TABLE app.doctor_offerings ENABLE ROW LEVEL SECURITY;
CREATE POLICY doctor_offerings_select ON app.doctor_offerings FOR SELECT TO ghayarly_app
  USING (provider_user_id = app.current_user_id() OR app.has_permission('ops.read')
         OR (active AND EXISTS (SELECT 1 FROM app.provider_profiles p WHERE p.user_id = provider_user_id AND p.verification_status = 'APPROVED')));
CREATE POLICY doctor_offerings_write ON app.doctor_offerings FOR ALL TO ghayarly_app
  USING (provider_user_id = app.current_user_id()) WITH CHECK (provider_user_id = app.current_user_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON app.doctor_offerings TO ghayarly_app;

-- ------------------------------------------------------------------ home-care coverage
-- Governorates where the company operates home visits (launch areas), managed by operations.
CREATE TABLE app.home_care_regions (
  governorate app.governorate PRIMARY KEY,
  active boolean NOT NULL DEFAULT false,
  note text CHECK (note IS NULL OR length(note) <= 300),
  updated_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app.home_care_regions (governorate) SELECT unnest(enum_range(NULL::app.governorate));
ALTER TABLE app.home_care_regions ENABLE ROW LEVEL SECURITY;
CREATE POLICY home_care_regions_select ON app.home_care_regions FOR SELECT TO ghayarly_app USING (true);
CREATE POLICY home_care_regions_update ON app.home_care_regions FOR UPDATE TO ghayarly_app
  USING (app.has_permission('ops.manage')) WITH CHECK (app.has_permission('ops.manage'));
GRANT SELECT, UPDATE ON app.home_care_regions TO ghayarly_app;

-- Areas a provider visits. No rows = the profile's own governorate and city.
CREATE TABLE app.provider_coverage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id text NOT NULL REFERENCES app.provider_profiles (user_id) ON DELETE CASCADE,
  governorate app.governorate NOT NULL,
  -- NULL = the whole governorate.
  city text CHECK (city IS NULL OR length(btrim(city)) BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX provider_coverage_unique ON app.provider_coverage (provider_user_id, governorate, lower(btrim(coalesce(city, ''))));
ALTER TABLE app.provider_coverage ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_coverage_select ON app.provider_coverage FOR SELECT TO ghayarly_app
  USING (provider_user_id = app.current_user_id() OR app.has_permission('ops.read')
         OR EXISTS (SELECT 1 FROM app.provider_profiles p WHERE p.user_id = provider_user_id AND p.verification_status = 'APPROVED'));
CREATE POLICY provider_coverage_write ON app.provider_coverage FOR ALL TO ghayarly_app
  USING (provider_user_id = app.current_user_id()) WITH CHECK (provider_user_id = app.current_user_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON app.provider_coverage TO ghayarly_app;

CREATE FUNCTION app.provider_covers(p_provider text, p_governorate app.governorate, p_city text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM app.provider_coverage WHERE provider_user_id = p_provider)
    THEN EXISTS (SELECT 1 FROM app.provider_coverage c WHERE c.provider_user_id = p_provider AND c.governorate = p_governorate
                 AND (c.city IS NULL OR lower(btrim(c.city)) = lower(btrim(p_city))))
    ELSE EXISTS (SELECT 1 FROM app.provider_profiles p WHERE p.user_id = p_provider AND p.governorate = p_governorate
                 AND lower(btrim(p.city)) = lower(btrim(p_city)))
  END
$$;

-- ------------------------------------------------------------------ time off
CREATE TABLE app.provider_time_off (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id text NOT NULL REFERENCES app.provider_profiles (user_id) ON DELETE CASCADE,
  period tstzrange NOT NULL CHECK (NOT isempty(period) AND lower(period) IS NOT NULL AND upper(period) IS NOT NULL
                                   AND upper(period) - lower(period) <= interval '120 days'),
  note text CHECK (note IS NULL OR length(note) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_time_off_idx ON app.provider_time_off USING gist (provider_user_id, period);
ALTER TABLE app.provider_time_off ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_time_off_own ON app.provider_time_off FOR ALL TO ghayarly_app
  USING (provider_user_id = app.current_user_id() OR app.has_permission('ops.read'))
  WITH CHECK (provider_user_id = app.current_user_id());
GRANT SELECT, INSERT, DELETE ON app.provider_time_off TO ghayarly_app;

-- ------------------------------------------------------------------ appointments
CREATE TABLE app.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE CHECK (reference ~ '^BK-[0-9A-F]{8}$'),
  kind app.appointment_kind NOT NULL,
  provider_user_id text NOT NULL REFERENCES app.provider_profiles (user_id),
  patient_id uuid NOT NULL REFERENCES app.patients (id) ON DELETE CASCADE,
  booked_by_user_id text NOT NULL REFERENCES auth."user" ("id"),
  -- Display labels captured at booking: each party sees the booking without reading the other's
  -- profile (a provider has no access to the patient's record).
  patient_display_name text NOT NULL CHECK (length(patient_display_name) BETWEEN 1 AND 80),
  provider_name_ar text NOT NULL,
  provider_name_en text NOT NULL,
  offering_id uuid REFERENCES app.doctor_offerings (id) ON DELETE SET NULL,
  service_id uuid REFERENCES app.nursing_services (id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  slot tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  status app.appointment_status NOT NULL DEFAULT 'REQUESTED',
  -- Snapshot at request time; paid to the provider at the visit (no online payment for bookings).
  price_piasters int NOT NULL CHECK (price_piasters >= 0),
  currency text NOT NULL DEFAULT 'EGP' CHECK (currency = 'EGP'),
  payment_method text NOT NULL DEFAULT 'PAY_AT_VISIT' CHECK (payment_method = 'PAY_AT_VISIT'),
  -- Home visits only. The full address is shown to the provider only once they accept.
  visit_governorate app.governorate,
  visit_city text CHECK (visit_city IS NULL OR length(btrim(visit_city)) BETWEEN 1 AND 80),
  visit_district text CHECK (visit_district IS NULL OR length(visit_district) <= 80),
  visit_address text CHECK (visit_address IS NULL OR length(btrim(visit_address)) BETWEEN 5 AND 300),
  contact_phone text CHECK (contact_phone IS NULL OR contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  clinical_authorization_attested boolean NOT NULL DEFAULT false,
  -- Optional note for the provider. Never sent in messages and never shown to operations staff.
  patient_note text CHECK (patient_note IS NULL OR length(patient_note) <= 500),
  status_reason text CHECK (status_reason IS NULL OR length(status_reason) <= 500),
  failure_category text CHECK (failure_category IS NULL OR failure_category IN
    ('PATIENT_NOT_AVAILABLE', 'ADDRESS_NOT_FOUND', 'UNSAFE_ENVIRONMENT', 'CLINICAL_ESCALATION', 'PROVIDER_UNABLE', 'OTHER')),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  respond_by timestamptz NOT NULL,
  confirmed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text CHECK (cancelled_by IS NULL OR cancelled_by IN ('PATIENT', 'PROVIDER', 'ADMIN')),
  reschedule_count int NOT NULL DEFAULT 0 CHECK (reschedule_count BETWEEN 0 AND 3),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT appt_times CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '12 hours'),
  CONSTRAINT appt_home_has_address CHECK (kind NOT IN ('DOCTOR_HOME_VISIT', 'NURSE_HOME_VISIT') OR status NOT IN ('REQUESTED', 'CONFIRMED', 'IN_PROGRESS')
    OR (visit_governorate IS NOT NULL AND visit_city IS NOT NULL AND visit_address IS NOT NULL AND contact_phone IS NOT NULL)),
  CONSTRAINT appt_nurse_has_service CHECK ((kind = 'NURSE_HOME_VISIT') = (service_id IS NOT NULL)),
  CONSTRAINT appt_doctor_has_offering CHECK (kind = 'NURSE_HOME_VISIT' OR offering_id IS NOT NULL OR status NOT IN ('REQUESTED', 'CONFIRMED')),
  CONSTRAINT appt_cancel_consistency CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)),
  -- The hard guarantees: no double booking of a provider or of a patient.
  CONSTRAINT appt_no_overlap_provider EXCLUDE USING gist (provider_user_id WITH =, slot WITH &&) WHERE (status IN ('REQUESTED', 'CONFIRMED', 'IN_PROGRESS')),
  CONSTRAINT appt_no_overlap_patient EXCLUDE USING gist (patient_id WITH =, slot WITH &&) WHERE (status IN ('REQUESTED', 'CONFIRMED', 'IN_PROGRESS'))
);
CREATE INDEX appointments_provider_idx ON app.appointments (provider_user_id, starts_at);
CREATE INDEX appointments_patient_idx ON app.appointments (patient_id, starts_at DESC);
CREATE INDEX appointments_booker_idx ON app.appointments (booked_by_user_id, starts_at DESC);
CREATE INDEX appointments_status_idx ON app.appointments (status, starts_at);
CREATE TRIGGER appointments_touch BEFORE UPDATE ON app.appointments FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE app.appointments ENABLE ROW LEVEL SECURITY;
-- Read: the person who booked, anyone with access to the patient, the provider, operations staff.
-- Writes happen only through the functions below.
CREATE POLICY appointments_select ON app.appointments FOR SELECT TO ghayarly_app
  USING (booked_by_user_id = app.current_user_id() OR provider_user_id = app.current_user_id()
         OR app.can_view_patient(patient_id) OR app.has_permission('ops.read'));
GRANT SELECT ON app.appointments TO ghayarly_app;

CREATE TABLE app.appointment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES app.appointments (id) ON DELETE CASCADE,
  actor_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('PATIENT', 'PROVIDER', 'ADMIN', 'SYSTEM')),
  event text NOT NULL CHECK (event IN ('REQUESTED', 'CONFIRMED', 'DECLINED', 'RESCHEDULED', 'CANCELLED', 'EXPIRED', 'STARTED', 'COMPLETED', 'NO_SHOW', 'VISIT_FAILED', 'ISSUE_REPORTED')),
  from_status app.appointment_status,
  to_status app.appointment_status NOT NULL,
  old_starts_at timestamptz,
  new_starts_at timestamptz,
  note text CHECK (note IS NULL OR length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX appointment_events_idx ON app.appointment_events (appointment_id, created_at);
ALTER TABLE app.appointment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY appointment_events_select ON app.appointment_events FOR SELECT TO ghayarly_app
  USING (EXISTS (SELECT 1 FROM app.appointments a WHERE a.id = appointment_id));
-- Append-only for the application: it holds SELECT only; events are written by the functions below.
GRANT SELECT ON app.appointment_events TO ghayarly_app;

-- ------------------------------------------------------------------ operational incidents
CREATE TYPE app.incident_status AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TABLE app.ops_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('VISIT_FAILED', 'PROVIDER_NO_SHOW', 'PATIENT_REPORTED_ISSUE', 'PAYMENT_MISMATCH', 'PAYMENT_WEBHOOK_REJECTED', 'REFUND_FAILED', 'ORDER_ISSUE', 'NOTIFICATION_FAILURES', 'OTHER')),
  severity text NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status app.incident_status NOT NULL DEFAULT 'OPEN',
  -- Operational facts only (category, reference). No clinical content.
  title text NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  detail text CHECK (detail IS NULL OR length(detail) <= 1000),
  related_type text CHECK (related_type IS NULL OR related_type ~ '^[a-z_]{2,40}$'),
  related_id uuid,
  domain text NOT NULL CHECK (domain IN ('CARE', 'COMMERCE', 'PLATFORM')),
  opened_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  resolution text CHECK (resolution IS NULL OR length(resolution) <= 1000),
  resolved_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT incident_resolution CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL AND resolution IS NOT NULL))
);
CREATE INDEX ops_incidents_open_idx ON app.ops_incidents (status, created_at DESC);
CREATE UNIQUE INDEX ops_incidents_one_open_per_subject ON app.ops_incidents (kind, related_type, related_id) WHERE status <> 'RESOLVED' AND related_id IS NOT NULL;
ALTER TABLE app.ops_incidents ENABLE ROW LEVEL SECURITY;
-- Care incidents are visible to care operations (ops.*); commerce incidents also to commerce staff
-- (orders.manage), who never see care incidents.
CREATE POLICY ops_incidents_select ON app.ops_incidents FOR SELECT TO ghayarly_app
  USING (app.has_permission('ops.read') OR (domain = 'COMMERCE' AND app.has_permission('orders.manage')));
CREATE POLICY ops_incidents_update ON app.ops_incidents FOR UPDATE TO ghayarly_app
  USING (app.has_permission('ops.manage') OR (domain = 'COMMERCE' AND app.has_permission('orders.manage')))
  WITH CHECK (app.has_permission('ops.manage') OR (domain = 'COMMERCE' AND app.has_permission('orders.manage')));
CREATE POLICY ops_incidents_insert ON app.ops_incidents FOR INSERT TO ghayarly_app
  WITH CHECK (app.has_permission('ops.manage') OR (domain = 'COMMERCE' AND app.has_permission('orders.manage')));
GRANT SELECT, INSERT, UPDATE ON app.ops_incidents TO ghayarly_app;

CREATE FUNCTION app.open_incident(p_kind text, p_severity text, p_domain text, p_title text, p_detail text, p_related_type text, p_related_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO app.ops_incidents (kind, severity, domain, title, detail, related_type, related_id, opened_by_user_id)
  VALUES (p_kind, p_severity, p_domain, p_title, p_detail, p_related_type, p_related_id, app.current_user_id())
  ON CONFLICT (kind, related_type, related_id) WHERE status <> 'RESOLVED' AND related_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.open_incident(text, text, text, text, text, text, uuid) FROM PUBLIC;

-- ------------------------------------------------------------------ availability
-- Why a provider cannot be booked right now (NULL = bookable). Same rules as the request function.
CREATE FUNCTION app.provider_booking_block(p_provider text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT CASE
    WHEN p.user_id IS NULL OR p.verification_status <> 'APPROVED' THEN 'PROVIDER_NOT_AVAILABLE'
    WHEN NOT app.provider_bookable(p.user_id) THEN 'PROVIDER_NOT_AVAILABLE'
    WHEN p.temporarily_unavailable THEN 'TEMPORARILY_UNAVAILABLE'
    WHEN p.availability_status IN ('AWAY', 'FULLY_BOOKED', 'EXISTING_PATIENTS_ONLY') AND (p.away_until IS NULL OR p.availability_status <> 'AWAY') THEN p.availability_status::text
    WHEN NOT EXISTS (SELECT 1 FROM app.provider_working_hours h WHERE h.provider_user_id = p.user_id) THEN 'NO_SCHEDULE'
    ELSE NULL
  END
  FROM (SELECT p_provider AS id) x LEFT JOIN app.provider_profiles p ON p.user_id = x.id
$$;

-- Free slots: working hours (local Cairo wall time, DST-aware through the tz database), stepped by
-- the visit duration, at least 2 hours ahead and at most 60 days ahead, outside time off and other
-- active bookings, on days below the provider's daily cap. p_exclude ignores one booking (used when
-- it is being moved).
CREATE FUNCTION app.provider_slots(p_provider text, p_duration int, p_from date, p_days int, p_exclude uuid DEFAULT NULL)
RETURNS TABLE (starts_at timestamptz, ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  WITH p AS (
    SELECT user_id, max_daily_appointments, availability_status, away_until FROM app.provider_profiles
    WHERE user_id = p_provider AND app.provider_booking_block(p_provider) IS NULL
      AND p_duration BETWEEN 10 AND 720 AND p_days BETWEEN 1 AND 62
  ),
  days AS (
    SELECT d::date AS day FROM p, generate_series(p_from::timestamp, (p_from + (p_days - 1))::timestamp, interval '1 day') AS d
    WHERE p.away_until IS NULL OR d::date > p.away_until
  ),
  cand AS (
    SELECT DISTINCT (days.day + make_interval(mins => m)) AT TIME ZONE 'Africa/Cairo' AS s, days.day
    FROM days
    JOIN app.provider_working_hours h ON h.provider_user_id = p_provider AND h.weekday = extract(dow FROM days.day)::int
    CROSS JOIN LATERAL generate_series(h.start_minute::int, h.end_minute::int - p_duration, p_duration) AS m
  ),
  used AS (
    SELECT (a.starts_at AT TIME ZONE 'Africa/Cairo')::date AS day, count(*) AS n
    FROM app.appointments a
    WHERE a.provider_user_id = p_provider AND a.status IN ('REQUESTED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED')
      AND a.id IS DISTINCT FROM p_exclude AND a.starts_at >= (p_from::timestamp AT TIME ZONE 'Africa/Cairo') - interval '1 day'
    GROUP BY 1
  )
  SELECT c.s, c.s + make_interval(mins => p_duration)
  FROM cand c CROSS JOIN p
  LEFT JOIN used u ON u.day = c.day
  WHERE c.s >= now() + interval '2 hours'
    AND c.s < now() + interval '60 days'
    AND coalesce(u.n, 0) < p.max_daily_appointments
    AND NOT EXISTS (SELECT 1 FROM app.appointments a WHERE a.provider_user_id = p_provider AND a.id IS DISTINCT FROM p_exclude
                    AND a.status IN ('REQUESTED', 'CONFIRMED', 'IN_PROGRESS')
                    AND a.slot && tstzrange(c.s, c.s + make_interval(mins => p_duration), '[)'))
    AND NOT EXISTS (SELECT 1 FROM app.provider_time_off t WHERE t.provider_user_id = p_provider
                    AND t.period && tstzrange(c.s, c.s + make_interval(mins => p_duration), '[)'))
  ORDER BY c.s
$$;

-- ------------------------------------------------------------------ booking functions
CREATE FUNCTION app.appointment_log(p_id uuid, p_role text, p_event text, p_from app.appointment_status, p_to app.appointment_status, p_old timestamptz, p_new timestamptz, p_note text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = app, pg_temp AS $$
  INSERT INTO app.appointment_events (appointment_id, actor_user_id, actor_role, event, from_status, to_status, old_starts_at, new_starts_at, note)
  VALUES (p_id, app.current_user_id(), p_role, p_event, p_from, p_to, p_old, p_new, left(p_note, 500))
$$;
REVOKE ALL ON FUNCTION app.appointment_log(uuid, text, text, app.appointment_status, app.appointment_status, timestamptz, timestamptz, text) FROM PUBLIC;

CREATE FUNCTION app.appointment_request(
  p_kind app.appointment_kind, p_provider text, p_patient uuid, p_offering uuid, p_service uuid, p_starts_at timestamptz,
  p_governorate app.governorate, p_city text, p_district text, p_address text, p_contact_phone text,
  p_note text, p_attested boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_actor text := app.current_user_id();
  v_prov app.provider_profiles%ROWTYPE;
  v_duration int;
  v_price int;
  v_block text;
  v_id uuid;
  v_ref text;
  v_respond timestamptz;
  v_home boolean := p_kind IN ('DOCTOR_HOME_VISIT', 'NURSE_HOME_VISIT');
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501'; END IF;
  IF NOT app.account_active(v_actor) OR coalesce((SELECT bookings_restricted FROM app.account_states WHERE user_id = v_actor), false) THEN
    RAISE EXCEPTION 'BOOKING_RESTRICTED' USING ERRCODE = '42501';
  END IF;
  IF NOT app.can_edit_patient(p_patient) THEN RAISE EXCEPTION 'PATIENT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF p_kind = 'DOCTOR_ONLINE' THEN RAISE EXCEPTION 'VIDEO_NOT_CONFIGURED' USING ERRCODE = 'P0001'; END IF;
  IF p_kind = 'DOCTOR_CLINIC' AND NOT app.flag_on('care.clinic_booking') THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = 'P0001'; END IF;
  IF v_home AND NOT app.flag_on('care.home_visit_booking') THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = 'P0001'; END IF;

  -- One booking at a time per provider: the daily cap and slot checks cannot race.
  PERFORM pg_advisory_xact_lock(hashtextextended('appointments:' || p_provider, 0));

  SELECT * INTO v_prov FROM app.provider_profiles WHERE user_id = p_provider;
  v_block := app.provider_booking_block(p_provider);
  IF v_block IS NOT NULL THEN RAISE EXCEPTION 'PROVIDER_NOT_BOOKABLE' USING ERRCODE = 'P0001', DETAIL = v_block; END IF;
  IF p_provider = v_actor THEN RAISE EXCEPTION 'CANNOT_BOOK_SELF' USING ERRCODE = 'P0001'; END IF;
  IF (p_kind = 'NURSE_HOME_VISIT') <> (v_prov.provider_type = 'NURSE') THEN RAISE EXCEPTION 'KIND_NOT_OFFERED' USING ERRCODE = 'P0001'; END IF;

  IF p_kind = 'NURSE_HOME_VISIT' THEN
    SELECT s.duration_minutes, s.base_price_piasters INTO v_duration, v_price
    FROM app.nursing_services s JOIN app.provider_services ps ON ps.service_id = s.id AND ps.provider_user_id = p_provider
    WHERE s.id = p_service AND s.active AND (NOT s.is_demo OR v_prov.is_demo);
    IF v_duration IS NULL THEN RAISE EXCEPTION 'SERVICE_NOT_OFFERED' USING ERRCODE = 'P0001'; END IF;
    IF (SELECT requires_clinical_authorization FROM app.nursing_services WHERE id = p_service) AND NOT coalesce(p_attested, false) THEN
      RAISE EXCEPTION 'CLINICAL_AUTHORIZATION_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT o.duration_minutes, o.price_piasters INTO v_duration, v_price
    FROM app.doctor_offerings o WHERE o.id = p_offering AND o.provider_user_id = p_provider AND o.kind = p_kind AND o.active;
    IF v_duration IS NULL THEN RAISE EXCEPTION 'KIND_NOT_OFFERED' USING ERRCODE = 'P0001'; END IF;
  END IF;

  IF v_home THEN
    IF p_governorate IS NULL OR nullif(btrim(p_city), '') IS NULL OR nullif(btrim(p_address), '') IS NULL OR p_contact_phone IS NULL THEN
      RAISE EXCEPTION 'ADDRESS_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
    IF NOT coalesce((SELECT active FROM app.home_care_regions WHERE governorate = p_governorate), false) THEN
      RAISE EXCEPTION 'AREA_NOT_SERVED' USING ERRCODE = 'P0001';
    END IF;
    IF NOT app.provider_covers(p_provider, p_governorate, p_city) THEN RAISE EXCEPTION 'OUTSIDE_PROVIDER_AREA' USING ERRCODE = 'P0001'; END IF;
  END IF;

  -- The requested time must be one of the provider's real free slots right now.
  IF NOT EXISTS (SELECT 1 FROM app.provider_slots(p_provider, v_duration, (p_starts_at AT TIME ZONE 'Africa/Cairo')::date, 1) s WHERE s.starts_at = p_starts_at) THEN
    RAISE EXCEPTION 'SLOT_NOT_AVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  v_ref := 'BK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_respond := least(clock_timestamp() + interval '24 hours', p_starts_at - interval '1 hour');
  INSERT INTO app.appointments (reference, kind, provider_user_id, patient_id, booked_by_user_id, patient_display_name, provider_name_ar, provider_name_en, offering_id, service_id, starts_at, ends_at,
                                price_piasters, visit_governorate, visit_city, visit_district, visit_address, contact_phone,
                                clinical_authorization_attested, patient_note, respond_by)
  VALUES (v_ref, p_kind, p_provider, p_patient, v_actor, (SELECT display_name FROM app.patients WHERE id = p_patient), v_prov.display_name_ar, v_prov.display_name_en,
          CASE WHEN p_kind <> 'NURSE_HOME_VISIT' THEN p_offering END,
          CASE WHEN p_kind = 'NURSE_HOME_VISIT' THEN p_service END, p_starts_at, p_starts_at + make_interval(mins => v_duration),
          v_price, CASE WHEN v_home THEN p_governorate END, CASE WHEN v_home THEN btrim(p_city) END, CASE WHEN v_home THEN nullif(btrim(p_district), '') END,
          CASE WHEN v_home THEN btrim(p_address) END, CASE WHEN v_home THEN p_contact_phone END, coalesce(p_attested, false), nullif(btrim(p_note), ''), v_respond)
  RETURNING id INTO v_id;
  PERFORM app.appointment_log(v_id, 'PATIENT', 'REQUESTED', NULL, 'REQUESTED', NULL, p_starts_at, NULL);
  RETURN v_id;
EXCEPTION
  WHEN exclusion_violation THEN RAISE EXCEPTION 'SLOT_TAKEN' USING ERRCODE = 'P0001';
END $$;

-- Who is acting on a booking: the provider, the patient side (booker or anyone who may edit the
-- patient), or operations staff.
CREATE FUNCTION app.appointment_actor_role(a app.appointments) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT CASE
    WHEN a.provider_user_id = app.current_user_id() THEN 'PROVIDER'
    WHEN a.booked_by_user_id = app.current_user_id() OR app.can_edit_patient(a.patient_id) THEN 'PATIENT'
    WHEN app.has_permission('ops.manage') THEN 'ADMIN'
    ELSE NULL
  END
$$;

CREATE FUNCTION app.appointment_respond(p_id uuid, p_accept boolean, p_reason text)
RETURNS app.appointment_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE a app.appointments%ROWTYPE;
BEGIN
  SELECT * INTO a FROM app.appointments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR a.provider_user_id IS DISTINCT FROM app.current_user_id() THEN RAISE EXCEPTION 'APPOINTMENT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF a.status <> 'REQUESTED' THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001'; END IF;
  IF a.respond_by <= now() OR a.starts_at <= now() THEN RAISE EXCEPTION 'REQUEST_EXPIRED' USING ERRCODE = 'P0001'; END IF;
  IF p_accept THEN
    IF NOT app.provider_bookable(a.provider_user_id) THEN RAISE EXCEPTION 'PROVIDER_NOT_BOOKABLE' USING ERRCODE = 'P0001'; END IF;
    UPDATE app.appointments SET status = 'CONFIRMED', confirmed_at = clock_timestamp() WHERE id = p_id;
    PERFORM app.appointment_log(p_id, 'PROVIDER', 'CONFIRMED', 'REQUESTED', 'CONFIRMED', NULL, NULL, NULL);
    RETURN 'CONFIRMED';
  END IF;
  IF coalesce(length(btrim(p_reason)), 0) < 3 THEN RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  UPDATE app.appointments SET status = 'DECLINED', status_reason = left(btrim(p_reason), 500) WHERE id = p_id;
  PERFORM app.appointment_log(p_id, 'PROVIDER', 'DECLINED', 'REQUESTED', 'DECLINED', NULL, NULL, p_reason);
  RETURN 'DECLINED';
END $$;

CREATE FUNCTION app.appointment_cancel(p_id uuid, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  a app.appointments%ROWTYPE;
  v_role text;
BEGIN
  SELECT * INTO a FROM app.appointments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'APPOINTMENT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_role := app.appointment_actor_role(a);
  IF v_role IS NULL THEN RAISE EXCEPTION 'APPOINTMENT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF a.status NOT IN ('REQUESTED', 'CONFIRMED') THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001'; END IF;
  IF a.starts_at <= now() AND v_role <> 'ADMIN' THEN RAISE EXCEPTION 'ALREADY_STARTED' USING ERRCODE = 'P0001'; END IF;
  IF v_role IN ('PROVIDER', 'ADMIN') AND coalesce(length(btrim(p_reason)), 0) < 3 THEN RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  UPDATE app.appointments SET status = 'CANCELLED', cancelled_at = clock_timestamp(), cancelled_by = v_role, status_reason = left(nullif(btrim(p_reason), ''), 500)
  WHERE id = p_id;
  PERFORM app.appointment_log(p_id, v_role, 'CANCELLED', a.status, 'CANCELLED', NULL, NULL, p_reason);
  IF v_role = 'ADMIN' THEN
    PERFORM app.write_audit('ops.appointment.cancel', 'appointment', p_id::text, a.patient_id, jsonb_build_object('reference', a.reference, 'reason', p_reason));
  END IF;
  RETURN v_role;
END $$;

CREATE FUNCTION app.appointment_reschedule(p_id uuid, p_starts_at timestamptz, p_reason text)
RETURNS app.appointment_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  a app.appointments%ROWTYPE;
  v_role text;
  v_duration int;
  v_status app.appointment_status;
BEGIN
  SELECT * INTO a FROM app.appointments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'APPOINTMENT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_role := app.appointment_actor_role(a);
  IF v_role NOT IN ('PATIENT', 'PROVIDER') OR v_role IS NULL THEN RAISE EXCEPTION 'APPOINTMENT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF a.status NOT IN ('REQUESTED', 'CONFIRMED') OR a.starts_at <= now() THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001'; END IF;
  IF a.reschedule_count >= 3 THEN RAISE EXCEPTION 'RESCHEDULE_LIMIT' USING ERRCODE = 'P0001'; END IF;
  IF a.kind = 'DOCTOR_CLINIC' AND NOT app.flag_on('care.clinic_booking') THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = 'P0001'; END IF;
  IF a.kind IN ('DOCTOR_HOME_VISIT', 'NURSE_HOME_VISIT') AND NOT app.flag_on('care.home_visit_booking') THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = 'P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('appointments:' || a.provider_user_id, 0));
  v_duration := (extract(epoch FROM a.ends_at - a.starts_at) / 60)::int;
  IF NOT EXISTS (SELECT 1 FROM app.provider_slots(a.provider_user_id, v_duration, (p_starts_at AT TIME ZONE 'Africa/Cairo')::date, 1, p_id) s WHERE s.starts_at = p_starts_at) THEN
    RAISE EXCEPTION 'SLOT_NOT_AVAILABLE' USING ERRCODE = 'P0001';
  END IF;
  -- A new time proposed by the patient side needs the provider's answer again; one set by the
  -- provider is confirmed (the patient is told and may cancel).
  v_status := CASE WHEN v_role = 'PROVIDER' THEN 'CONFIRMED'::app.appointment_status ELSE 'REQUESTED'::app.appointment_status END;
  UPDATE app.appointments SET starts_at = p_starts_at, ends_at = p_starts_at + make_interval(mins => v_duration), status = v_status,
    reschedule_count = reschedule_count + 1,
    confirmed_at = CASE WHEN v_status = 'CONFIRMED' THEN clock_timestamp() ELSE NULL END,
    respond_by = CASE WHEN v_status = 'REQUESTED' THEN least(clock_timestamp() + interval '24 hours', p_starts_at - interval '1 hour') ELSE respond_by END
  WHERE id = p_id;
  PERFORM app.appointment_log(p_id, v_role, 'RESCHEDULED', a.status, v_status, a.starts_at, p_starts_at, p_reason);
  RETURN v_status;
EXCEPTION
  WHEN exclusion_violation THEN RAISE EXCEPTION 'SLOT_TAKEN' USING ERRCODE = 'P0001';
END $$;

-- Provider progress on the day: START (home visits), COMPLETE, NO_SHOW, FAIL (home visit could not be
-- carried out — opens an operations incident).
CREATE FUNCTION app.appointment_progress(p_id uuid, p_action text, p_reason text, p_category text)
RETURNS app.appointment_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  a app.appointments%ROWTYPE;
  v_to app.appointment_status;
  v_home boolean;
BEGIN
  SELECT * INTO a FROM app.appointments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR a.provider_user_id IS DISTINCT FROM app.current_user_id() THEN RAISE EXCEPTION 'APPOINTMENT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_home := a.kind IN ('DOCTOR_HOME_VISIT', 'NURSE_HOME_VISIT');
  IF p_action = 'START' AND v_home AND a.status = 'CONFIRMED' AND now() >= a.starts_at - interval '2 hours' THEN
    v_to := 'IN_PROGRESS';
    UPDATE app.appointments SET status = v_to, started_at = clock_timestamp() WHERE id = p_id;
    PERFORM app.appointment_log(p_id, 'PROVIDER', 'STARTED', a.status, v_to, NULL, NULL, NULL);
  ELSIF p_action = 'COMPLETE' AND a.status IN ('CONFIRMED', 'IN_PROGRESS') AND now() >= a.starts_at THEN
    v_to := 'COMPLETED';
    UPDATE app.appointments SET status = v_to, completed_at = clock_timestamp() WHERE id = p_id;
    UPDATE app.provider_profiles SET completed_visits = completed_visits + 1 WHERE user_id = a.provider_user_id;
    PERFORM app.appointment_log(p_id, 'PROVIDER', 'COMPLETED', a.status, v_to, NULL, NULL, NULL);
  ELSIF p_action = 'NO_SHOW' AND a.status = 'CONFIRMED' AND now() >= a.starts_at + interval '15 minutes' THEN
    v_to := 'NO_SHOW';
    UPDATE app.appointments SET status = v_to, status_reason = left(nullif(btrim(p_reason), ''), 500) WHERE id = p_id;
    PERFORM app.appointment_log(p_id, 'PROVIDER', 'NO_SHOW', a.status, v_to, NULL, NULL, p_reason);
  ELSIF p_action = 'FAIL' AND v_home AND a.status IN ('CONFIRMED', 'IN_PROGRESS') AND now() >= a.starts_at - interval '2 hours' THEN
    IF p_category IS NULL THEN RAISE EXCEPTION 'CATEGORY_REQUIRED' USING ERRCODE = 'P0001'; END IF;
    v_to := 'VISIT_FAILED';
    UPDATE app.appointments SET status = v_to, failure_category = p_category, status_reason = left(nullif(btrim(p_reason), ''), 500) WHERE id = p_id;
    PERFORM app.appointment_log(p_id, 'PROVIDER', 'VISIT_FAILED', a.status, v_to, NULL, NULL, p_reason);
    PERFORM app.open_incident('VISIT_FAILED', CASE WHEN p_category IN ('UNSAFE_ENVIRONMENT', 'CLINICAL_ESCALATION') THEN 'HIGH' ELSE 'MEDIUM' END, 'CARE',
      'Home visit ' || a.reference || ' could not be completed', 'Category: ' || p_category, 'appointment', p_id);
  ELSE
    RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_to;
END $$;

-- The patient side reports a problem after the start time (e.g. the provider did not arrive).
CREATE FUNCTION app.appointment_report_issue(p_id uuid, p_category text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  a app.appointments%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO a FROM app.appointments WHERE id = p_id;
  IF NOT FOUND OR app.appointment_actor_role(a) IS DISTINCT FROM 'PATIENT' THEN RAISE EXCEPTION 'APPOINTMENT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF p_category NOT IN ('PROVIDER_DID_NOT_ARRIVE', 'PROVIDER_LATE', 'CONDUCT', 'PRICE_DISPUTE', 'OTHER') THEN RAISE EXCEPTION 'INVALID_CATEGORY' USING ERRCODE = 'P0001'; END IF;
  IF a.starts_at > now() OR a.status NOT IN ('CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW', 'VISIT_FAILED') THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001'; END IF;
  v_id := app.open_incident(CASE WHEN p_category = 'PROVIDER_DID_NOT_ARRIVE' THEN 'PROVIDER_NO_SHOW' ELSE 'PATIENT_REPORTED_ISSUE' END,
    CASE WHEN p_category IN ('PROVIDER_DID_NOT_ARRIVE', 'CONDUCT') THEN 'HIGH' ELSE 'MEDIUM' END, 'CARE',
    'Patient reported an issue with ' || a.reference, 'Category: ' || p_category, 'appointment', p_id);
  PERFORM app.appointment_log(p_id, 'PATIENT', 'ISSUE_REPORTED', a.status, a.status, NULL, NULL, p_category);
  RETURN v_id;
END $$;

-- Worker (system context): requests not answered in time expire. Returns the expired bookings.
CREATE FUNCTION app.appointments_expire() RETURNS SETOF uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE r record;
BEGIN
  IF app.current_user_id() IS NOT NULL THEN RAISE EXCEPTION 'SYSTEM_ONLY' USING ERRCODE = '42501'; END IF;
  FOR r IN SELECT id FROM app.appointments WHERE status = 'REQUESTED' AND (respond_by <= now() OR starts_at <= now()) FOR UPDATE SKIP LOCKED LOOP
    UPDATE app.appointments SET status = 'EXPIRED' WHERE id = r.id;
    PERFORM app.appointment_log(r.id, 'SYSTEM', 'EXPIRED', 'REQUESTED', 'EXPIRED', NULL, NULL, NULL);
    RETURN NEXT r.id;
  END LOOP;
END $$;

-- What a booking message needs: the booking facts and both parties' contacts, resolved server-side
-- (never returned to clients). Allowed for a party to the booking, operations staff, or the worker.
CREATE FUNCTION app.appointment_message_context(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  a app.appointments%ROWTYPE;
  v jsonb;
BEGIN
  SELECT * INTO a FROM app.appointments WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF app.current_user_id() IS NOT NULL AND app.appointment_actor_role(a) IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object(
    'id', a.id, 'reference', a.reference, 'kind', a.kind, 'status', a.status, 'startsAt', a.starts_at, 'cancelledBy', a.cancelled_by,
    'providerNameAr', a.provider_name_ar, 'providerNameEn', a.provider_name_en,
    'contacts', (
      SELECT coalesce(jsonb_agg(c), '[]'::jsonb) FROM (
        SELECT 'PATIENT' AS side, u.id AS "userId",
               CASE WHEN u.email LIKE '%@phone.ghayarly.invalid' OR u.email LIKE '%@deleted.invalid' THEN NULL ELSE u.email END AS email,
               coalesce(CASE WHEN u."phoneNumberVerified" THEN u."phoneNumber" END,
                        (SELECT pt.phone FROM app.patients pt JOIN app.patient_access pa ON pa.patient_id = pt.id
                          WHERE pa.user_id = u.id AND pa.relationship = 'SELF' AND pa.status = 'ACTIVE' LIMIT 1)) AS phone,
               coalesce(up.locale::text, 'ar') AS locale
        FROM auth."user" u LEFT JOIN app.user_profiles up ON up.user_id = u.id WHERE u.id = a.booked_by_user_id
        UNION ALL
        SELECT 'PROVIDER', u.id,
               CASE WHEN u.email LIKE '%@phone.ghayarly.invalid' OR u.email LIKE '%@deleted.invalid' THEN NULL ELSE u.email END,
               CASE WHEN u."phoneNumberVerified" THEN u."phoneNumber" END,
               coalesce(up.locale::text, 'ar')
        FROM auth."user" u LEFT JOIN app.user_profiles up ON up.user_id = u.id WHERE u.id = a.provider_user_id
      ) c))
  INTO v;
  RETURN v;
END $$;

-- Account management (ADR 0013): when a clinician is suspended or restricted, staff see how many open
-- bookings need handing over. A count only — no patient details.
CREATE FUNCTION app.provider_open_bookings(p_user text) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT CASE WHEN app.has_permission('users.read') OR app.has_permission('ops.read') THEN
    (SELECT count(*)::int FROM app.appointments WHERE provider_user_id = p_user AND status IN ('REQUESTED', 'CONFIRMED', 'IN_PROGRESS') AND ends_at > now())
  END
$$;

REVOKE ALL ON FUNCTION app.provider_slots(text, int, date, int, uuid), app.provider_booking_block(text), app.provider_covers(text, app.governorate, text),
  app.appointment_request(app.appointment_kind, text, uuid, uuid, uuid, timestamptz, app.governorate, text, text, text, text, text, boolean),
  app.appointment_respond(uuid, boolean, text), app.appointment_cancel(uuid, text), app.appointment_reschedule(uuid, timestamptz, text),
  app.appointment_progress(uuid, text, text, text), app.appointment_report_issue(uuid, text), app.appointments_expire(),
  app.appointment_message_context(uuid), app.appointment_actor_role(app.appointments), app.flag_on(text), app.provider_open_bookings(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.provider_slots(text, int, date, int, uuid), app.provider_booking_block(text), app.provider_covers(text, app.governorate, text),
  app.appointment_request(app.appointment_kind, text, uuid, uuid, uuid, timestamptz, app.governorate, text, text, text, text, text, boolean),
  app.appointment_respond(uuid, boolean, text), app.appointment_cancel(uuid, text), app.appointment_reschedule(uuid, timestamptz, text),
  app.appointment_progress(uuid, text, text, text), app.appointment_report_issue(uuid, text), app.appointments_expire(),
  app.appointment_message_context(uuid), app.appointment_actor_role(app.appointments), app.flag_on(text), app.provider_open_bookings(text) TO ghayarly_app;

-- Account deletion: future bookings of the person (as patient side or provider) are cancelled.
CREATE FUNCTION app.appointments_forget_deleted_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  UPDATE app.appointments SET status = 'CANCELLED', cancelled_at = clock_timestamp(),
    cancelled_by = CASE WHEN provider_user_id = NEW.user_id THEN 'PROVIDER' ELSE 'PATIENT' END, status_reason = 'Account deleted'
  WHERE (booked_by_user_id = NEW.user_id OR provider_user_id = NEW.user_id) AND status IN ('REQUESTED', 'CONFIRMED');
  -- The person's notes, address and contact number go with the account (status history stays).
  UPDATE app.appointments SET patient_note = NULL, visit_address = NULL, visit_district = NULL, contact_phone = NULL
  WHERE booked_by_user_id = NEW.user_id AND status NOT IN ('REQUESTED', 'CONFIRMED', 'IN_PROGRESS');
  RETURN NEW;
END $$;
CREATE TRIGGER account_deletions_cancel_appointments AFTER INSERT ON app.account_deletions
  FOR EACH ROW EXECUTE FUNCTION app.appointments_forget_deleted_account();

-- ------------------------------------------------------------------ outbox access for business actions
-- Patients and providers queue messages inside their own transactions but may not read the outbox,
-- and INSERT … ON CONFLICT needs read access. These two functions are the narrow doors: one queues a
-- non-secret message (dedupe-safe), one cancels pending messages of a booking the caller is party to.
CREATE FUNCTION app.notification_enqueue(p_channel app.notification_channel, p_purpose text, p_locale text, p_recipient text, p_user text,
  p_subject text, p_body text, p_send_after timestamptz, p_expires_at timestamptz, p_related_type text, p_related_id uuid, p_dedupe_key text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = app, pg_temp AS $$
  INSERT INTO app.notifications (channel, purpose, locale, recipient, recipient_user_id, secret, subject, body, send_after, next_attempt_at, expires_at, related_type, related_id, dedupe_key)
  VALUES (p_channel, p_purpose, p_locale, p_recipient, p_user, false, p_subject, p_body, p_send_after, p_send_after, p_expires_at, p_related_type, p_related_id, p_dedupe_key)
  ON CONFLICT (dedupe_key) DO NOTHING
$$;

CREATE FUNCTION app.notifications_cancel_related(p_type text, p_id uuid, p_purposes text[]) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  a app.appointments%ROWTYPE;
  n int;
BEGIN
  IF app.current_user_id() IS NOT NULL AND NOT app.has_permission('ops.manage') THEN
    IF p_type = 'appointment' THEN
      SELECT * INTO a FROM app.appointments WHERE id = p_id;
      IF NOT FOUND OR app.appointment_actor_role(a) IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
    ELSE
      RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
    END IF;
  END IF;
  UPDATE app.notifications SET status = 'CANCELLED', updated_at = clock_timestamp()
  WHERE related_type = p_type AND related_id = p_id AND status = 'QUEUED' AND (p_purposes IS NULL OR purpose = ANY (p_purposes));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION app.notification_enqueue(app.notification_channel, text, text, text, text, text, text, timestamptz, timestamptz, text, uuid, text),
  app.notifications_cancel_related(text, uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.notification_enqueue(app.notification_channel, text, text, text, text, text, text, timestamptz, timestamptz, text, uuid, text),
  app.notifications_cancel_related(text, uuid, text[]) TO ghayarly_app;
