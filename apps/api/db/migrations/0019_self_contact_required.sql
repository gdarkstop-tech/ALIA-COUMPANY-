-- 0019 — The account holder's own profile must keep a governorate, a city / area and an Egyptian
-- mobile number (product decision 2026-10-28: needed to match people with clinicians in their area
-- and to reach them about bookings and home visits). Onboarding cannot be completed without them
-- (API), and once saved they cannot be cleared through the app (this guard). Family profiles a
-- person manages (children, parents) keep them optional.
CREATE FUNCTION app.patients_self_contact_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  IF current_user <> 'ghayarly_app' OR NEW.linked_user_id IS NULL THEN RETURN NEW; END IF;
  IF (OLD.governorate IS NOT NULL AND NEW.governorate IS NULL)
     OR (nullif(btrim(OLD.city), '') IS NOT NULL AND nullif(btrim(NEW.city), '') IS NULL)
     OR (OLD.phone IS NOT NULL AND NEW.phone IS NULL) THEN
    RAISE EXCEPTION 'SELF_CONTACT_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER patients_self_contact BEFORE UPDATE ON app.patients FOR EACH ROW EXECUTE FUNCTION app.patients_self_contact_guard();
