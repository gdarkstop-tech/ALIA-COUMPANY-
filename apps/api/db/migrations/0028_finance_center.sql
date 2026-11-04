-- 0028 — AI Finance Center (ADR 0018).
-- Read-only financial views over data the platform already records (AI metering, budgets, store
-- entitlements, provider ledger) plus one new input: provider invoices entered by finance staff, so
-- metered costs can be compared with what providers actually bill. Nothing here moves money: there
-- is no payout, withdrawal or transfer function, and revenue is never estimated.

-- ------------------------------------------------------------------ permissions
CREATE OR REPLACE FUNCTION app.role_has_permission(p_role app.role, p_permission text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE p_role
    WHEN 'ADMIN' THEN p_permission = ANY (ARRAY[
      'provider.verification.review', 'provider.verification.decide', 'provider.capacity.manage_any',
      'catalog.tetrasol.manage', 'catalog.services.manage', 'audit.read', 'users.read', 'users.roles.grant',
      'catalog.content.approve', 'catalog.brands.manage', 'users.status.manage', 'users.appeals.decide',
      'ai.config.manage', 'ai.usage.read', 'ai.eval.manage', 'ai.data.approve', 'knowledge.manage',
      'wound.registry.read', 'finance.read', 'finance.manage'])
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

-- Finance staff read the metering and budget tables (aggregated in the API; no message content
-- lives in these tables).
ALTER POLICY ai_usage_select ON app.ai_usage
  USING (user_id = app.current_user_id() OR app.has_permission('ai.usage.read') OR app.has_permission('finance.read'));
ALTER POLICY ai_budget_read ON app.ai_budget
  USING (app.has_permission('ai.config.manage') OR app.has_permission('ai.usage.read') OR app.has_permission('finance.read'));
ALTER POLICY ai_plan_budgets_read ON app.ai_plan_budgets
  USING (app.has_permission('ai.config.manage') OR app.has_permission('ai.usage.read') OR app.has_permission('finance.read'));
ALTER POLICY ai_budget_alerts_read ON app.ai_budget_alerts
  USING (app.has_permission('ai.config.manage') OR app.has_permission('ai.usage.read') OR app.has_permission('finance.read'));
ALTER POLICY ai_eval_runs_read ON app.ai_eval_runs
  USING (app.has_permission('ai.eval.manage') OR app.has_permission('ai.clinical.review') OR app.has_permission('ai.config.manage') OR app.has_permission('ai.usage.read') OR app.has_permission('finance.read'));

-- ------------------------------------------------------------------ provider invoices
-- What each AI provider actually billed for a calendar month (USD micro-dollars), entered from the
-- provider's invoice by finance staff. Append-only: a correction is a new row that supersedes the
-- previous one, so the history of what was entered stays visible.
CREATE TABLE app.ai_provider_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider app.ai_provider NOT NULL CHECK (provider <> 'SIMULATED'),
  month date NOT NULL CHECK (month = date_trunc('month', month)::date),
  amount_micros bigint NOT NULL CHECK (amount_micros >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  reference text NOT NULL CHECK (length(reference) BETWEEN 3 AND 120),
  note text CHECK (note IS NULL OR length(note) <= 500),
  supersedes uuid REFERENCES app.ai_provider_invoices (id),
  recorded_by_user_id text NOT NULL REFERENCES auth."user" ("id"),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ai_provider_invoices_month_idx ON app.ai_provider_invoices (month, provider, recorded_at DESC);
CREATE UNIQUE INDEX ai_provider_invoices_superseded_once ON app.ai_provider_invoices (supersedes) WHERE supersedes IS NOT NULL;
CREATE TRIGGER ai_provider_invoices_append_only BEFORE UPDATE OR DELETE ON app.ai_provider_invoices FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
ALTER TABLE app.ai_provider_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_provider_invoices_read ON app.ai_provider_invoices FOR SELECT TO ghayarly_app USING (app.has_permission('finance.read'));
CREATE POLICY ai_provider_invoices_insert ON app.ai_provider_invoices FOR INSERT TO ghayarly_app
  WITH CHECK (app.has_permission('finance.manage') AND recorded_by_user_id = app.current_user_id());
GRANT SELECT, INSERT ON app.ai_provider_invoices TO ghayarly_app;

-- ------------------------------------------------------------------ aggregate views for finance
-- Store-verified subscriptions per plan / source / status, as counts only (no account identities).
CREATE FUNCTION app.finance_subscription_counts()
RETURNS TABLE (plan_code app.plan_code, source app.entitlement_source, status app.entitlement_status, accounts int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT app.has_permission('finance.read') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT e.plan_code, e.source, e.status, count(DISTINCT e.user_id)::int FROM app.entitlements e GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
END $$;

-- Platform fees and clinician earnings recorded in the provider ledger, split real / demo.
CREATE FUNCTION app.finance_ledger_totals()
RETURNS TABLE (entry_type app.ledger_entry_type, status app.ledger_status, is_demo boolean, entries int, amount_piasters bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT app.has_permission('finance.read') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT l.entry_type, l.status, l.is_demo, count(*)::int, coalesce(sum(l.amount_piasters), 0)::bigint FROM app.provider_ledger_entries l GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
END $$;

REVOKE ALL ON FUNCTION app.finance_subscription_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.finance_ledger_totals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.finance_subscription_counts() TO ghayarly_app;
GRANT EXECUTE ON FUNCTION app.finance_ledger_totals() TO ghayarly_app;
