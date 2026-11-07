-- 0030 — Notifications: e-mail / SMS outbox, delivery tracking (ADR 0020), and the operations
-- permissions used by Phase 8 (operations center, orders, payments).

-- ------------------------------------------------------------------ permissions
CREATE OR REPLACE FUNCTION app.role_has_permission(p_role app.role, p_permission text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE p_role
    WHEN 'ADMIN' THEN p_permission = ANY (ARRAY[
      'provider.verification.review', 'provider.verification.decide', 'provider.capacity.manage_any',
      'catalog.tetrasol.manage', 'catalog.services.manage', 'audit.read', 'users.read', 'users.roles.grant',
      'catalog.content.approve', 'catalog.brands.manage', 'users.status.manage', 'users.appeals.decide',
      'ai.config.manage', 'ai.usage.read', 'ai.eval.manage', 'ai.data.approve', 'knowledge.manage',
      'wound.registry.read', 'finance.read', 'finance.manage',
      'ops.read', 'ops.manage', 'orders.manage', 'payments.read', 'payments.refund'])
    WHEN 'CLINICAL_REVIEWER' THEN p_permission = ANY (ARRAY['provider.verification.review', 'provider.verification.decide', 'catalog.content.approve', 'ai.clinical.review', 'ai.safety.review', 'knowledge.manage',
      'wound.registry.read', 'wound.research.review'])
    WHEN 'SUPPORT' THEN p_permission = ANY (ARRAY['users.read', 'provider.verification.review'])
    WHEN 'TRUST_AND_SAFETY' THEN p_permission = ANY (ARRAY['audit.read', 'safety.reports.read', 'users.read', 'users.status.manage', 'users.appeals.decide', 'ai.safety.review'])
    -- Commerce staff fulfil orders and see payment states — never appointments or clinical records.
    WHEN 'COMMERCE_MANAGER' THEN p_permission = ANY (ARRAY['catalog.tetrasol.manage', 'orders.manage', 'payments.read'])
    WHEN 'WOUND_RESEARCHER' THEN p_permission = ANY (ARRAY['wound.registry.read', 'wound.research.access'])
    WHEN 'PRESENTATION_APPROVER' THEN p_permission = ANY (ARRAY['wound.registry.read', 'wound.presentation.manage'])
    ELSE false
  END
$$;

-- ------------------------------------------------------------------ notifications
CREATE TYPE app.notification_channel AS ENUM ('EMAIL', 'SMS');
-- QUEUED → SENDING → SENT (accepted by the provider) → DELIVERED (receipt), or FAILED (retries
-- exhausted), UNDELIVERABLE (permanent: invalid number / address), EXPIRED (no longer useful, e.g. a
-- reminder after the appointment), CANCELLED (the event it was about was cancelled).
CREATE TYPE app.notification_status AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'UNDELIVERABLE', 'EXPIRED', 'CANCELLED');

CREATE TABLE app.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel app.notification_channel NOT NULL,
  purpose text NOT NULL CHECK (purpose ~ '^[a-z][a-z0-9_.-]{2,60}$'),
  locale text NOT NULL CHECK (locale IN ('ar', 'en')),
  -- E-mail address or E.164 number.
  recipient text NOT NULL CHECK (length(recipient) BETWEEN 3 AND 320),
  -- No foreign key: sign-up e-mails are sent inside Better Auth's own transaction, before the user
  -- row is visible to other connections. Account deletion removes the rows (trigger below).
  recipient_user_id text,
  -- Secret messages (sign-in codes, verification and reset links) are sent once and never stored.
  secret boolean NOT NULL DEFAULT false,
  subject text CHECK (subject IS NULL OR length(subject) <= 200),
  body text CHECK (body IS NULL OR length(body) <= 4000),
  CONSTRAINT secret_never_stored CHECK (NOT secret OR (body IS NULL AND subject IS NULL)),
  CONSTRAINT queued_has_content CHECK (secret OR body IS NOT NULL),
  status app.notification_status NOT NULL DEFAULT 'QUEUED',
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts int NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  send_after timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  provider text CHECK (provider IS NULL OR provider ~ '^[a-z][a-z0-9_-]{1,30}$'),
  provider_message_id text CHECK (provider_message_id IS NULL OR length(provider_message_id) <= 120),
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 300),
  related_type text CHECK (related_type IS NULL OR related_type ~ '^[a-z_]{2,40}$'),
  related_id uuid,
  -- Idempotency: one message per business event (e.g. "appointment:<id>:reminder-24h").
  dedupe_key text UNIQUE CHECK (dedupe_key IS NULL OR length(dedupe_key) <= 200),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  sent_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX notifications_due_idx ON app.notifications (next_attempt_at) WHERE status = 'QUEUED';
CREATE INDEX notifications_related_idx ON app.notifications (related_type, related_id);
CREATE INDEX notifications_provider_idx ON app.notifications (provider, provider_message_id);
CREATE INDEX notifications_recipient_idx ON app.notifications (recipient, purpose, created_at DESC);
CREATE INDEX notifications_status_idx ON app.notifications (status, created_at DESC);

ALTER TABLE app.notifications ENABLE ROW LEVEL SECURITY;
-- Business actions queue messages in the actor's own transaction (a patient's booking notifies the
-- doctor), so any authenticated context may insert. Contents are readable only by the delivery
-- worker (system context) and operations staff.
CREATE POLICY notifications_insert ON app.notifications FOR INSERT TO ghayarly_app WITH CHECK (true);
CREATE POLICY notifications_select ON app.notifications FOR SELECT TO ghayarly_app
  USING (app.current_user_id() IS NULL OR app.has_permission('ops.read'));
CREATE POLICY notifications_update ON app.notifications FOR UPDATE TO ghayarly_app
  USING (app.current_user_id() IS NULL OR app.has_permission('ops.manage'))
  WITH CHECK (app.current_user_id() IS NULL OR app.has_permission('ops.manage'));
GRANT SELECT, INSERT, UPDATE ON app.notifications TO ghayarly_app;

-- Claims due messages for one worker (system context only); a message left SENDING by a crashed
-- worker is released after 10 minutes.
CREATE FUNCTION app.notifications_claim(p_limit int) RETURNS SETOF app.notifications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.current_user_id() IS NOT NULL THEN RAISE EXCEPTION 'SYSTEM_ONLY' USING ERRCODE = '42501'; END IF;
  UPDATE app.notifications SET status = 'QUEUED', updated_at = clock_timestamp()
    WHERE status = 'SENDING' AND updated_at < clock_timestamp() - interval '10 minutes';
  UPDATE app.notifications SET status = 'EXPIRED', updated_at = clock_timestamp()
    WHERE status = 'QUEUED' AND expires_at IS NOT NULL AND expires_at <= now();
  RETURN QUERY
    UPDATE app.notifications n SET status = 'SENDING', attempts = n.attempts + 1, updated_at = clock_timestamp()
    WHERE n.id IN (
      SELECT id FROM app.notifications
      WHERE status = 'QUEUED' AND send_after <= now() AND next_attempt_at <= now()
      ORDER BY next_attempt_at LIMIT least(greatest(p_limit, 1), 200) FOR UPDATE SKIP LOCKED)
    RETURNING n.*;
END $$;
REVOKE ALL ON FUNCTION app.notifications_claim(int) FROM PUBLIC;

-- Retention: recipients are personal data. Secret-message metadata is needed only for the sending
-- caps (one day) and short operational review; other messages for six months of support history.
CREATE FUNCTION app.notifications_retention() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE n int;
BEGIN
  IF app.current_user_id() IS NOT NULL THEN RAISE EXCEPTION 'SYSTEM_ONLY' USING ERRCODE = '42501'; END IF;
  DELETE FROM app.notifications
   WHERE (secret AND created_at < now() - interval '30 days')
      OR (status NOT IN ('QUEUED', 'SENDING') AND created_at < now() - interval '180 days');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION app.notifications_retention() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.notifications_retention() TO ghayarly_app;

-- Account deletion removes the person's message history (addresses, numbers, appointment times).
CREATE FUNCTION app.notifications_forget_deleted_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  DELETE FROM app.notifications WHERE recipient_user_id = NEW.user_id;
  RETURN NEW;
END $$;
CREATE TRIGGER account_deletions_forget_notifications AFTER INSERT ON app.account_deletions
  FOR EACH ROW EXECUTE FUNCTION app.notifications_forget_deleted_account();
GRANT EXECUTE ON FUNCTION app.notifications_claim(int) TO ghayarly_app;
