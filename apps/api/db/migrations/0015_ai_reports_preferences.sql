-- 0015 — "Report AI response" with a reviewer workflow, and personal assistant preferences.
--
--   * A person can report any assistant answer they received. The report keeps a snapshot of that
--     answer (and, only if they agree, the question that led to it), so reviewers never need access
--     to the conversation itself.
--   * Reviewers (ai.safety.review: Trust & Safety, clinical reviewers) read report content only
--     through app.ai_report_detail(), which writes the audit log every time.
--   * Every state change is an append-only event. Deleting the account redacts the snapshots but
--     keeps the incident statistics (model, reason, outcome).

-- ------------------------------------------------------------------ permissions
CREATE OR REPLACE FUNCTION app.role_has_permission(p_role app.role, p_permission text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE p_role
    WHEN 'ADMIN' THEN p_permission = ANY (ARRAY[
      'provider.verification.review', 'provider.verification.decide', 'provider.capacity.manage_any',
      'catalog.tetrasol.manage', 'catalog.services.manage', 'audit.read', 'users.read', 'users.roles.grant',
      'catalog.content.approve', 'catalog.brands.manage', 'users.status.manage', 'users.appeals.decide',
      'ai.config.manage', 'ai.usage.read', 'ai.eval.manage', 'ai.data.approve'])
    WHEN 'CLINICAL_REVIEWER' THEN p_permission = ANY (ARRAY['provider.verification.review', 'provider.verification.decide', 'catalog.content.approve', 'ai.clinical.review', 'ai.safety.review'])
    WHEN 'SUPPORT' THEN p_permission = ANY (ARRAY['users.read', 'provider.verification.review'])
    WHEN 'TRUST_AND_SAFETY' THEN p_permission = ANY (ARRAY['audit.read', 'safety.reports.read', 'users.read', 'users.status.manage', 'users.appeals.decide', 'ai.safety.review'])
    WHEN 'COMMERCE_MANAGER' THEN p_permission = ANY (ARRAY['catalog.tetrasol.manage'])
    ELSE false
  END
$$;

-- ------------------------------------------------------------------ preferences
CREATE TABLE app.ai_preferences (
  user_id text PRIMARY KEY REFERENCES auth."user" ("id") ON DELETE CASCADE,
  reply_language text NOT NULL DEFAULT 'auto' CHECK (reply_language IN ('auto', 'ar', 'en')),
  detail_level text NOT NULL DEFAULT 'brief' CHECK (detail_level IN ('brief', 'detailed')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER ai_preferences_touch BEFORE UPDATE ON app.ai_preferences FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
ALTER TABLE app.ai_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_preferences_own ON app.ai_preferences FOR ALL TO ghayarly_app
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
GRANT SELECT, INSERT ON app.ai_preferences TO ghayarly_app;
GRANT UPDATE (reply_language, detail_level, updated_at) ON app.ai_preferences TO ghayarly_app;

-- ------------------------------------------------------------------ reports
CREATE TABLE app.ai_response_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id text NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE,
  message_id uuid REFERENCES app.ai_messages (id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('INACCURATE', 'UNSAFE', 'MISSED_EMERGENCY', 'INAPPROPRIATE', 'PRIVACY', 'PRODUCT_PROMOTION', 'OTHER')),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  -- Snapshots (what the reviewer sees). The question only if the reporter chose to include it.
  answer_snapshot text NOT NULL CHECK (length(answer_snapshot) BETWEEN 1 AND 12000),
  question_snapshot text CHECK (question_snapshot IS NULL OR length(question_snapshot) <= 12000),
  message_kind text NOT NULL,
  provider app.ai_provider,
  model_id text,
  route_key text,
  locale text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED')),
  resolution text CHECK (resolution IS NULL OR resolution IN ('MODEL_ERROR', 'POLICY_GAP', 'SAFETY_ESCALATION', 'PRIVACY_ISSUE', 'NO_ISSUE', 'OTHER')),
  assigned_to_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  redacted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resolved_has_resolution CHECK (status NOT IN ('RESOLVED', 'DISMISSED') OR resolution IS NOT NULL)
);
CREATE UNIQUE INDEX ai_response_reports_once ON app.ai_response_reports (reporter_user_id, message_id) WHERE message_id IS NOT NULL;
CREATE INDEX ai_response_reports_queue ON app.ai_response_reports (status, created_at);
CREATE TRIGGER ai_response_reports_touch BEFORE UPDATE ON app.ai_response_reports FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE app.ai_report_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES app.ai_response_reports (id) ON DELETE CASCADE,
  actor_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  event text NOT NULL CHECK (event IN ('OPENED', 'IN_REVIEW', 'RESOLVED', 'DISMISSED', 'NOTE', 'REDACTED')),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER ai_report_events_append_only BEFORE UPDATE ON app.ai_report_events FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

ALTER TABLE app.ai_response_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_report_events ENABLE ROW LEVEL SECURITY;
-- Reporters see their own reports' status; reviewers see the queue. Snapshot columns are not
-- granted at all: content is read only through the audited detail function.
CREATE POLICY ai_response_reports_read ON app.ai_response_reports FOR SELECT TO ghayarly_app
  USING (reporter_user_id = app.current_user_id() OR app.has_permission('ai.safety.review'));
GRANT SELECT (id, reporter_user_id, message_id, reason, message_kind, provider, model_id, route_key, locale, status, resolution, assigned_to_user_id, redacted_at, created_at, updated_at)
  ON app.ai_response_reports TO ghayarly_app;
CREATE POLICY ai_report_events_read ON app.ai_report_events FOR SELECT TO ghayarly_app USING (app.has_permission('ai.safety.review'));
GRANT SELECT ON app.ai_report_events TO ghayarly_app;

-- The person reports one answer they received.
CREATE FUNCTION app.ai_report_response(p_message uuid, p_reason text, p_note text, p_include_question boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_user text := app.current_user_id();
  v_msg app.ai_messages;
  v_conv app.ai_conversations;
  v_question text;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_msg FROM app.ai_messages WHERE id = p_message AND user_id = v_user AND role = 'assistant';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_conv FROM app.ai_conversations WHERE id = v_msg.conversation_id;
  IF p_include_question THEN
    SELECT content INTO v_question FROM app.ai_messages
      WHERE conversation_id = v_msg.conversation_id AND role = 'user' AND created_at <= v_msg.created_at
      ORDER BY created_at DESC LIMIT 1;
  END IF;
  BEGIN
    INSERT INTO app.ai_response_reports (reporter_user_id, message_id, reason, note, answer_snapshot, question_snapshot, message_kind, provider, model_id, route_key, locale)
    VALUES (v_user, p_message, p_reason, nullif(left(trim(coalesce(p_note, '')), 1000), ''), v_msg.content, v_question, v_msg.kind, v_msg.provider, v_msg.model_id, v_conv.route_key,
            (SELECT locale FROM app.user_profiles WHERE user_id = v_user))
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ALREADY_REPORTED' USING ERRCODE = 'P0001';
  END;
  INSERT INTO app.ai_report_events (report_id, actor_user_id, event) VALUES (v_id, v_user, 'OPENED');
  PERFORM app.write_audit('ai.report.opened', 'ai_response_report', v_id::text, NULL, jsonb_build_object('reason', p_reason, 'model', v_msg.model_id, 'kind', v_msg.kind));
  RETURN v_id;
END $$;

-- A reviewer reads one report (audited each time).
CREATE FUNCTION app.ai_report_detail(p_report uuid)
RETURNS TABLE (answer_snapshot text, question_snapshot text, note text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT app.has_permission('ai.safety.review') THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app.ai_response_reports WHERE id = p_report) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  PERFORM app.write_audit('ai.report.viewed', 'ai_response_report', p_report::text, NULL, '{}'::jsonb);
  RETURN QUERY SELECT r.answer_snapshot, r.question_snapshot, r.note FROM app.ai_response_reports r WHERE r.id = p_report;
END $$;

-- Review workflow: OPEN → IN_REVIEW → RESOLVED / DISMISSED (or straight to a decision), with a note.
CREATE FUNCTION app.ai_report_transition(p_report uuid, p_status text, p_resolution text, p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_rep app.ai_response_reports;
BEGIN
  IF NOT app.has_permission('ai.safety.review') THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_rep FROM app.ai_response_reports WHERE id = p_report FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF p_status = 'NOTE' THEN
    IF p_note IS NULL OR length(trim(p_note)) < 3 THEN RAISE EXCEPTION 'NOTE_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  ELSIF NOT ((v_rep.status = 'OPEN' AND p_status IN ('IN_REVIEW', 'RESOLVED', 'DISMISSED')) OR (v_rep.status = 'IN_REVIEW' AND p_status IN ('RESOLVED', 'DISMISSED'))) THEN
    RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001';
  ELSIF p_status IN ('RESOLVED', 'DISMISSED') AND (p_resolution IS NULL OR p_note IS NULL OR length(trim(p_note)) < 3) THEN
    RAISE EXCEPTION 'RESOLUTION_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_status <> 'NOTE' THEN
    UPDATE app.ai_response_reports SET status = p_status,
      resolution = CASE WHEN p_status IN ('RESOLVED', 'DISMISSED') THEN p_resolution ELSE resolution END,
      assigned_to_user_id = coalesce(assigned_to_user_id, app.current_user_id())
    WHERE id = p_report;
  END IF;
  INSERT INTO app.ai_report_events (report_id, actor_user_id, event, note) VALUES (p_report, app.current_user_id(), p_status, nullif(trim(coalesce(p_note, '')), ''));
  PERFORM app.write_audit('ai.report.' || lower(p_status), 'ai_response_report', p_report::text, NULL, jsonb_build_object('resolution', p_resolution));
END $$;

REVOKE ALL ON FUNCTION app.ai_report_response(uuid, text, text, boolean), app.ai_report_detail(uuid), app.ai_report_transition(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ai_report_response(uuid, text, text, boolean), app.ai_report_detail(uuid), app.ai_report_transition(uuid, text, text, text) TO ghayarly_app;

-- Account deletion: conversations go (0011); report snapshots are redacted, statistics kept.
CREATE OR REPLACE FUNCTION app.ai_forget_deleted_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  DELETE FROM app.ai_conversations WHERE user_id = NEW.user_id;
  DELETE FROM app.ai_preferences WHERE user_id = NEW.user_id;
  INSERT INTO app.ai_report_events (report_id, event)
    SELECT id, 'REDACTED' FROM app.ai_response_reports WHERE reporter_user_id = NEW.user_id AND redacted_at IS NULL;
  UPDATE app.ai_response_reports SET answer_snapshot = '[removed with the account]', question_snapshot = NULL, note = NULL, redacted_at = now()
    WHERE reporter_user_id = NEW.user_id AND redacted_at IS NULL;
  RETURN NEW;
END $$;
