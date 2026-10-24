-- 0009 — Account status management (Admin Console → Users).
--
--   * ACTIVE / SUSPENDED (optionally until a date) / BLOCKED, plus a separate restriction that
--     stops a clinician from receiving NEW bookings (hidden from discovery) without suspending them.
--   * Every change goes through app.set_account_status(): permission-checked, never on oneself,
--     staff accounts only by an ADMIN, a reason category and an internal note always required, and
--     for clinicians a care-continuity note (what happens to their current patients).
--   * Suspension and blocking sign the person out everywhere and remove staff permissions at the
--     database level (app.has_role / app.has_permission) — the API is not the only gate.
--   * Nothing is deleted: medical records, ledgers and audit history are untouched.
--   * Append-only history; the person sees their own history without staff-internal notes.
--   * Appeals: one open appeal at a time, decided by someone other than the person who imposed the
--     restriction.

CREATE TYPE app.account_status AS ENUM ('ACTIVE', 'SUSPENDED', 'BLOCKED');
CREATE TYPE app.status_reason AS ENUM (
  'SAFETY_CONCERN', 'FRAUD_SUSPECTED', 'TERMS_VIOLATION', 'CREDENTIAL_ISSUE', 'HARASSMENT',
  'PAYMENT_ABUSE', 'LEGAL_REQUEST', 'IDENTITY_VERIFICATION', 'OTHER', 'RESOLVED', 'APPEAL_GRANTED');
CREATE TYPE app.status_action AS ENUM ('SUSPEND', 'BLOCK', 'REACTIVATE', 'RESTRICT_BOOKINGS', 'LIFT_BOOKING_RESTRICTION', 'APPEAL_GRANTED');
CREATE TYPE app.appeal_status AS ENUM ('OPEN', 'GRANTED', 'DENIED', 'WITHDRAWN');

-- ------------------------------------------------------------------ current state (no row = ACTIVE)
CREATE TABLE app.account_states (
  user_id text PRIMARY KEY REFERENCES auth."user" ("id") ON DELETE CASCADE,
  status app.account_status NOT NULL DEFAULT 'ACTIVE',
  bookings_restricted boolean NOT NULL DEFAULT false,
  reason app.status_reason,
  -- Shown to the person (plain language, no internal detail).
  public_message text CHECK (public_message IS NULL OR length(public_message) BETWEEN 1 AND 500),
  suspended_until timestamptz,
  updated_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT until_only_for_suspension CHECK (suspended_until IS NULL OR status = 'SUSPENDED'),
  CONSTRAINT restriction_needs_reason CHECK ((status = 'ACTIVE' AND NOT bookings_restricted) OR reason IS NOT NULL)
);
ALTER TABLE app.account_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_states_select ON app.account_states FOR SELECT TO ghayarly_app
  USING (user_id = app.current_user_id() OR app.has_permission('users.read'));
GRANT SELECT ON app.account_states TO ghayarly_app;
-- No write grants: only app.set_account_status() / app.decide_appeal() write here.

CREATE TABLE app.account_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE,
  action app.status_action NOT NULL,
  from_status app.account_status NOT NULL,
  to_status app.account_status NOT NULL,
  bookings_restricted boolean NOT NULL,
  reason app.status_reason NOT NULL,
  public_message text,
  -- Staff-internal: never shown to the person (see app.my_account_status_events).
  staff_note text NOT NULL CHECK (length(staff_note) BETWEEN 10 AND 2000),
  care_continuity_note text CHECK (care_continuity_note IS NULL OR length(care_continuity_note) BETWEEN 10 AND 2000),
  suspended_until timestamptz,
  actor_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  appeal_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX account_status_events_user_idx ON app.account_status_events (user_id, created_at DESC);
CREATE TRIGGER account_status_events_append_only BEFORE UPDATE OR DELETE ON app.account_status_events FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
ALTER TABLE app.account_status_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_status_events_select ON app.account_status_events FOR SELECT TO ghayarly_app USING (app.has_permission('users.read'));
GRANT SELECT ON app.account_status_events TO ghayarly_app;

-- The person's own history, without staff-internal notes or who decided.
CREATE VIEW app.my_account_status_events WITH (security_barrier = true) AS
  SELECT id, action, from_status, to_status, bookings_restricted, reason, public_message, suspended_until, created_at
  FROM app.account_status_events
  WHERE user_id = app.current_user_id();
GRANT SELECT ON app.my_account_status_events TO ghayarly_app;

-- ------------------------------------------------------------------ status helpers
-- Effective status: a suspension with an end date lapses on its own.
CREATE FUNCTION app.account_status_of(p_user text) RETURNS app.account_status
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce((
    SELECT CASE WHEN s.status = 'SUSPENDED' AND s.suspended_until IS NOT NULL AND s.suspended_until <= now() THEN 'ACTIVE'::app.account_status ELSE s.status END
    FROM app.account_states s WHERE s.user_id = p_user), 'ACTIVE')
$$;

CREATE FUNCTION app.account_active(p_user text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT p_user IS NOT NULL AND app.account_status_of(p_user) = 'ACTIVE'
$$;

-- A clinician can be found and booked only while active and not booking-restricted.
CREATE FUNCTION app.provider_bookable(p_user text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT app.account_active(p_user)
     AND NOT coalesce((SELECT bookings_restricted FROM app.account_states WHERE user_id = p_user), false)
$$;

-- Suspended / blocked accounts hold no roles or permissions at the database level.
CREATE OR REPLACE FUNCTION app.has_role(p_role app.role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT app.account_active(app.current_user_id()) AND EXISTS (
    SELECT 1 FROM app.user_roles
    WHERE user_id = app.current_user_id() AND role = p_role AND revoked_at IS NULL
  )
$$;

CREATE OR REPLACE FUNCTION app.has_permission(p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT app.account_active(app.current_user_id()) AND EXISTS (
    SELECT 1 FROM app.user_roles ur
    WHERE ur.user_id = app.current_user_id() AND ur.revoked_at IS NULL
      AND app.role_has_permission(ur.role, p_permission)
  )
$$;

-- Discovery: restricted / suspended clinicians disappear from search (they still see themselves).
DROP POLICY provider_profiles_select ON app.provider_profiles;
CREATE POLICY provider_profiles_select ON app.provider_profiles FOR SELECT TO ghayarly_app
  USING (
    user_id = app.current_user_id()
    OR (verification_status = 'APPROVED' AND app.catalog_visible(is_demo) AND app.provider_bookable(user_id))
    OR app.has_permission('provider.verification.review')
  );
CREATE OR REPLACE VIEW app.public_provider_credentials WITH (security_barrier = true) AS
  SELECT c.provider_user_id, c.kind, c.issuer, c.reviewed_at AS verified_at
  FROM app.provider_credentials c
  JOIN app.provider_profiles p ON p.user_id = c.provider_user_id
  WHERE c.status = 'APPROVED' AND p.verification_status = 'APPROVED' AND app.catalog_visible(p.is_demo) AND app.provider_bookable(p.user_id);

-- ------------------------------------------------------------------ appeals
CREATE TABLE app.account_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE,
  event_id uuid REFERENCES app.account_status_events (id) ON DELETE SET NULL,
  message text NOT NULL CHECK (length(message) BETWEEN 10 AND 2000),
  status app.appeal_status NOT NULL DEFAULT 'OPEN',
  decision_note text CHECK (decision_note IS NULL OR length(decision_note) BETWEEN 10 AND 2000),
  decided_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decided_has_note CHECK (status IN ('OPEN', 'WITHDRAWN') OR (decision_note IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX account_appeals_one_open ON app.account_appeals (user_id) WHERE status = 'OPEN';
ALTER TABLE app.account_appeals ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_appeals_select ON app.account_appeals FOR SELECT TO ghayarly_app
  USING (user_id = app.current_user_id() OR app.has_permission('users.appeals.decide') OR app.has_permission('users.read'));
-- A person may appeal only while a restriction applies to them, and only their own latest decision.
CREATE POLICY account_appeals_insert ON app.account_appeals FOR INSERT TO ghayarly_app
  WITH CHECK (
    user_id = app.current_user_id() AND status = 'OPEN' AND decision_note IS NULL AND decided_by_user_id IS NULL
    AND (app.account_status_of(user_id) <> 'ACTIVE' OR coalesce((SELECT bookings_restricted FROM app.account_states s WHERE s.user_id = account_appeals.user_id), false))
    AND (event_id IS NULL OR EXISTS (SELECT 1 FROM app.my_account_status_events e WHERE e.id = event_id))
  );
GRANT SELECT, INSERT ON app.account_appeals TO ghayarly_app;

-- ------------------------------------------------------------------ the only writers
CREATE FUNCTION app.set_account_status(
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
  SELECT EXISTS (SELECT 1 FROM app.user_roles WHERE user_id = p_user AND revoked_at IS NULL AND role IN ('ADMIN', 'CLINICAL_REVIEWER', 'SUPPORT', 'TRUST_AND_SAFETY', 'COMMERCE_MANAGER')) INTO v_is_staff;
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

CREATE FUNCTION app.decide_appeal(p_appeal uuid, p_decision app.appeal_status, p_note text) RETURNS app.appeal_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_actor text := app.current_user_id();
  v_appeal app.account_appeals;
  v_from app.account_status;
  v_imposed_by text;
BEGIN
  IF NOT app.has_permission('users.appeals.decide') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF p_decision NOT IN ('GRANTED', 'DENIED') THEN RAISE EXCEPTION 'INVALID_DECISION' USING ERRCODE = 'P0001'; END IF;
  IF coalesce(length(trim(p_note)), 0) < 10 THEN RAISE EXCEPTION 'DECISION_NOTE_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_appeal FROM app.account_appeals WHERE id = p_appeal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'APPEAL_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_appeal.status <> 'OPEN' THEN RAISE EXCEPTION 'APPEAL_ALREADY_DECIDED' USING ERRCODE = 'P0001'; END IF;
  IF v_appeal.user_id = v_actor THEN RAISE EXCEPTION 'SELF_ACTION_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  -- The appeal is heard by someone other than the person who imposed the restriction.
  SELECT actor_user_id INTO v_imposed_by FROM app.account_status_events
   WHERE user_id = v_appeal.user_id AND action IN ('SUSPEND', 'BLOCK', 'RESTRICT_BOOKINGS') ORDER BY created_at DESC LIMIT 1;
  IF v_imposed_by = v_actor THEN RAISE EXCEPTION 'APPEAL_REVIEWER_MUST_DIFFER' USING ERRCODE = '42501'; END IF;

  UPDATE app.account_appeals SET status = p_decision, decision_note = trim(p_note), decided_by_user_id = v_actor, decided_at = now() WHERE id = p_appeal;

  IF p_decision = 'GRANTED' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('account_status:' || v_appeal.user_id, 0));
    v_from := app.account_status_of(v_appeal.user_id);
    UPDATE app.account_states SET status = 'ACTIVE', bookings_restricted = false, reason = NULL, public_message = NULL, suspended_until = NULL,
      updated_by_user_id = v_actor, updated_at = now() WHERE user_id = v_appeal.user_id;
    INSERT INTO app.account_status_events (user_id, action, from_status, to_status, bookings_restricted, reason, staff_note, actor_user_id, appeal_id)
    VALUES (v_appeal.user_id, 'APPEAL_GRANTED', v_from, 'ACTIVE', false, 'APPEAL_GRANTED', trim(p_note), v_actor, p_appeal);
  END IF;
  PERFORM app.write_audit('users.appeal.' || lower(p_decision::text), 'user', v_appeal.user_id, NULL, jsonb_build_object('appealId', p_appeal));
  RETURN p_decision;
END $$;

-- Staff screens: when the person last had a live session (sessions end on sign-out / expiry).
CREATE FUNCTION app.user_last_session_at(p_user text) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT CASE WHEN app.has_permission('users.read') THEN (SELECT max(s."updatedAt") FROM auth."session" s WHERE s."userId" = p_user) END
$$;
-- How many patient profiles the person manages — a count only, never the records themselves.
CREATE FUNCTION app.user_patient_profile_count(p_user text) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT CASE WHEN app.has_permission('users.read') THEN (SELECT count(*)::int FROM app.patient_access a WHERE a.user_id = p_user AND a.status = 'ACTIVE') END
$$;
REVOKE ALL ON FUNCTION app.user_last_session_at(text), app.user_patient_profile_count(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.user_last_session_at(text), app.user_patient_profile_count(text) TO ghayarly_app;

REVOKE ALL ON FUNCTION app.account_status_of(text), app.account_active(text), app.provider_bookable(text),
  app.set_account_status(text, app.status_action, app.status_reason, text, text, timestamptz, text),
  app.decide_appeal(uuid, app.appeal_status, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.account_status_of(text), app.account_active(text), app.provider_bookable(text),
  app.set_account_status(text, app.status_action, app.status_reason, text, text, timestamptz, text),
  app.decide_appeal(uuid, app.appeal_status, text) TO ghayarly_app;
