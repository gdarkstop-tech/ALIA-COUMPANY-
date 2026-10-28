-- 0025 — Company-product knowledge and controlled product discovery for DMW Medical AI (ADR 0014).
--
--   * Product knowledge entries — official indications, approved claims, contraindications, FAQs
--     and educational material — are bilingual, carry an evidence reference, and go live only when a
--     clinical reviewer (ai.clinical.review) who did not write that revision approves them. Each
--     approval is an immutable version recording who approved it and when; editing an approved
--     entry starts a new draft while the approved version stays live.
--   * Keywords (Arabic / English terms, synonyms, common misspellings) link a term to a product:
--     either naming the product itself, or pointing at one of its INDICATIONS. Every keyword needs
--     the same clinical approval, and an indication keyword can trigger product information only
--     while that indication has a live approved version. Catalogue (commercial) staff can propose
--     but never approve anything here.
--   * Discovery matches the person's current message only (never profiles, history or health
--     records), returns only approved, published, non-demo products of an active company brand, at
--     most two, and only while `ai.product_discovery` is ON (or for internal test accounts).
--   * Answers that mention products are checked by the API (packages/shared/src/products.ts); a
--     rejected answer is recorded as company cost (INVALID_OUTPUT), never shown, and capped per day.

-- ------------------------------------------------------------------ flag
INSERT INTO app.feature_flags (key, enabled, risk, requires_regulatory_evidence, description) VALUES
  ('ai.product_discovery', false, 'HIGH', true, 'The assistant may show approved company-product information (official indications, warnings, contraindications) when a person asks about a product or describes a situation within an approved indication. Needs legal approval of the product claims for AI use, a clinical-safety review of indications and keywords, and an evaluation of answers that mention products.');

-- ------------------------------------------------------------------ entries (working copies) and approved versions
CREATE TABLE app.product_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES app.products (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('INDICATION', 'CLAIM', 'CONTRAINDICATION', 'FAQ', 'EDUCATION')),
  -- The candidate search topic an indication covers (e.g. pressure-ulcers). A topic is not a claim:
  -- only the approved indication text is.
  topic text CHECK (topic IS NULL OR topic ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- FAQ: the question; other kinds: a short title.
  title_ar text NOT NULL CHECK (length(btrim(title_ar)) BETWEEN 2 AND 200),
  title_en text NOT NULL CHECK (length(btrim(title_en)) BETWEEN 2 AND 200),
  body_ar text NOT NULL CHECK (length(btrim(body_ar)) BETWEEN 2 AND 4000),
  body_en text NOT NULL CHECK (length(btrim(body_en)) BETWEEN 2 AND 4000),
  -- Where the statement comes from: regulatory registration, approved label / IFU section, study.
  evidence_reference text NOT NULL CHECK (length(btrim(evidence_reference)) BETWEEN 3 AND 300),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'RETIRED')),
  edited_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT indication_has_topic CHECK (kind <> 'INDICATION' OR topic IS NOT NULL)
);
CREATE INDEX product_knowledge_product_idx ON app.product_knowledge (product_id);
CREATE TRIGGER product_knowledge_touch BEFORE UPDATE ON app.product_knowledge FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE app.product_knowledge_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES app.product_knowledge (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES app.products (id) ON DELETE CASCADE,
  version int NOT NULL,
  kind text NOT NULL,
  topic text,
  title_ar text NOT NULL,
  title_en text NOT NULL,
  body_ar text NOT NULL,
  body_en text NOT NULL,
  evidence_reference text NOT NULL,
  edited_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  approved_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  approval_note text NOT NULL CHECK (length(approval_note) BETWEEN 3 AND 1000),
  superseded_at timestamptz,
  UNIQUE (entry_id, version)
);
CREATE UNIQUE INDEX product_knowledge_versions_one_live ON app.product_knowledge_versions (entry_id) WHERE superseded_at IS NULL;
CREATE INDEX product_knowledge_versions_product_idx ON app.product_knowledge_versions (product_id) WHERE superseded_at IS NULL;
-- Approved text never changes; only superseded_at is set when a newer version goes live.
CREATE FUNCTION app.product_knowledge_versions_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.entry_id, NEW.product_id, NEW.version, NEW.kind, NEW.topic, NEW.title_ar, NEW.title_en, NEW.body_ar, NEW.body_en, NEW.evidence_reference, NEW.approved_by_user_id, NEW.approved_at, NEW.approval_note)
     IS DISTINCT FROM (OLD.entry_id, OLD.product_id, OLD.version, OLD.kind, OLD.topic, OLD.title_ar, OLD.title_en, OLD.body_ar, OLD.body_en, OLD.evidence_reference, OLD.approved_by_user_id, OLD.approved_at, OLD.approval_note)
     OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at) THEN
    RAISE EXCEPTION 'product_knowledge_versions is append-only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_knowledge_versions_immutable BEFORE UPDATE ON app.product_knowledge_versions FOR EACH ROW EXECUTE FUNCTION app.product_knowledge_versions_immutable();

-- Editing content makes the working copy a draft again (the approved version stays live). The
-- product and kind of an entry never change: a different statement is a different entry.
CREATE FUNCTION app.product_knowledge_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  IF current_user <> 'ghayarly_app' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF (SELECT is_demo FROM app.products WHERE id = NEW.product_id) THEN RAISE EXCEPTION 'DEMO_PRODUCT' USING ERRCODE = 'P0001'; END IF;
    NEW.status := 'DRAFT'; NEW.edited_by_user_id := app.current_user_id();
  ELSIF (NEW.product_id, NEW.kind) IS DISTINCT FROM (OLD.product_id, OLD.kind) THEN
    RAISE EXCEPTION 'PROTECTED_FIELD' USING ERRCODE = '42501';
  ELSIF (NEW.topic, NEW.title_ar, NEW.title_en, NEW.body_ar, NEW.body_en, NEW.evidence_reference)
        IS DISTINCT FROM (OLD.topic, OLD.title_ar, OLD.title_en, OLD.body_ar, OLD.body_en, OLD.evidence_reference) THEN
    IF OLD.status = 'RETIRED' THEN RAISE EXCEPTION 'KNOWLEDGE_RETIRED' USING ERRCODE = 'P0001'; END IF;
    NEW.status := 'DRAFT'; NEW.edited_by_user_id := app.current_user_id();
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'USE_WORKFLOW_FUNCTIONS' USING ERRCODE = '42501';
  END IF;
  PERFORM app.write_audit('product.knowledge.' || lower(TG_OP), 'product_knowledge', NEW.id::text, NULL, jsonb_build_object('product', NEW.product_id, 'kind', NEW.kind));
  RETURN NEW;
END $$;
CREATE TRIGGER product_knowledge_guard BEFORE INSERT OR UPDATE ON app.product_knowledge FOR EACH ROW EXECUTE FUNCTION app.product_knowledge_guard();

-- ------------------------------------------------------------------ keywords
CREATE TABLE app.product_keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES app.products (id) ON DELETE CASCADE,
  -- NULL: the term names the product itself (a name variant, synonym or misspelling of it).
  -- Otherwise the INDICATION of the same product that the term points to.
  indication_id uuid REFERENCES app.product_knowledge (id) ON DELETE CASCADE,
  term text NOT NULL CHECK (length(btrim(term)) BETWEEN 2 AND 80),
  term_normalized text NOT NULL,
  locale text NOT NULL CHECK (locale IN ('ar', 'en')),
  variant text NOT NULL CHECK (variant IN ('KEYWORD', 'SYNONYM', 'MISSPELLING')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'RETIRED')),
  created_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  approved_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  approved_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT keyword_approved_consistency CHECK (status <> 'APPROVED' OR approved_at IS NOT NULL),
  CONSTRAINT keyword_retired_consistency CHECK ((status = 'RETIRED') = (retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX product_keywords_live_unique ON app.product_keywords (product_id, term_normalized, indication_id) NULLS NOT DISTINCT WHERE status <> 'RETIRED';
CREATE INDEX product_keywords_approved_idx ON app.product_keywords (term_normalized) WHERE status = 'APPROVED';

CREATE FUNCTION app.product_keywords_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  IF current_user <> 'ghayarly_app' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'USE_WORKFLOW_FUNCTIONS' USING ERRCODE = '42501'; END IF;
  IF (SELECT is_demo FROM app.products WHERE id = NEW.product_id) THEN RAISE EXCEPTION 'DEMO_PRODUCT' USING ERRCODE = 'P0001'; END IF;
  IF NEW.indication_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM app.product_knowledge WHERE id = NEW.indication_id AND product_id = NEW.product_id AND kind = 'INDICATION') THEN
    RAISE EXCEPTION 'INDICATION_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  NEW.term := btrim(NEW.term);
  NEW.term_normalized := app.search_normalize(NEW.term);
  IF length(NEW.term_normalized) < 2 THEN RAISE EXCEPTION 'INVALID_VALUE' USING ERRCODE = 'P0001'; END IF;
  NEW.status := 'PENDING'; NEW.approved_at := NULL; NEW.approved_by_user_id := NULL; NEW.retired_at := NULL;
  NEW.created_by_user_id := app.current_user_id();
  PERFORM app.write_audit('product.keyword.created', 'product_keyword', NEW.id::text, NULL,
    jsonb_build_object('product', NEW.product_id, 'indication', NEW.indication_id, 'term', NEW.term));
  RETURN NEW;
END $$;
CREATE TRIGGER product_keywords_guard BEFORE INSERT OR UPDATE ON app.product_keywords FOR EACH ROW EXECUTE FUNCTION app.product_keywords_guard();

-- ------------------------------------------------------------------ access
ALTER TABLE app.product_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.product_knowledge_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.product_keywords ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_knowledge_read ON app.product_knowledge FOR SELECT TO ghayarly_app
  USING (app.has_permission('catalog.tetrasol.manage') OR app.has_permission('ai.clinical.review'));
CREATE POLICY product_knowledge_insert ON app.product_knowledge FOR INSERT TO ghayarly_app WITH CHECK (app.has_permission('catalog.tetrasol.manage'));
CREATE POLICY product_knowledge_update ON app.product_knowledge FOR UPDATE TO ghayarly_app
  USING (app.has_permission('catalog.tetrasol.manage')) WITH CHECK (app.has_permission('catalog.tetrasol.manage'));
GRANT SELECT, INSERT ON app.product_knowledge TO ghayarly_app;
GRANT UPDATE (topic, title_ar, title_en, body_ar, body_en, evidence_reference, updated_at) ON app.product_knowledge TO ghayarly_app;
CREATE POLICY product_keywords_read ON app.product_keywords FOR SELECT TO ghayarly_app
  USING (app.has_permission('catalog.tetrasol.manage') OR app.has_permission('ai.clinical.review'));
CREATE POLICY product_keywords_insert ON app.product_keywords FOR INSERT TO ghayarly_app WITH CHECK (app.has_permission('catalog.tetrasol.manage'));
GRANT SELECT, INSERT ON app.product_keywords TO ghayarly_app;

-- ------------------------------------------------------------------ workflow
CREATE FUNCTION app.product_knowledge_submit(p_entry uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT app.has_permission('catalog.tetrasol.manage') THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  UPDATE app.product_knowledge SET status = 'IN_REVIEW' WHERE id = p_entry AND status = 'DRAFT';
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001'; END IF;
  PERFORM app.write_audit('product.knowledge.submitted', 'product_knowledge', p_entry::text, NULL, '{}'::jsonb);
END $$;

-- A clinical reviewer who did not write this revision makes it the live version.
CREATE FUNCTION app.product_knowledge_approve(p_entry uuid, p_note text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_e app.product_knowledge;
  v_next int;
  v_version uuid;
BEGIN
  IF NOT app.has_permission('ai.clinical.review') THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF p_note IS NULL OR length(trim(p_note)) < 3 THEN RAISE EXCEPTION 'NOTE_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_e FROM app.product_knowledge WHERE id = p_entry FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_e.status <> 'IN_REVIEW' THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001'; END IF;
  IF v_e.edited_by_user_id = app.current_user_id() THEN RAISE EXCEPTION 'SELF_APPROVAL_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM app.product_knowledge_versions WHERE entry_id = p_entry;
  UPDATE app.product_knowledge_versions SET superseded_at = now() WHERE entry_id = p_entry AND superseded_at IS NULL;
  INSERT INTO app.product_knowledge_versions (entry_id, product_id, version, kind, topic, title_ar, title_en, body_ar, body_en, evidence_reference, edited_by_user_id, approved_by_user_id, approval_note)
  VALUES (p_entry, v_e.product_id, v_next, v_e.kind, v_e.topic, v_e.title_ar, v_e.title_en, v_e.body_ar, v_e.body_en, v_e.evidence_reference, v_e.edited_by_user_id, app.current_user_id(), trim(p_note))
  RETURNING id INTO v_version;
  UPDATE app.product_knowledge SET status = 'APPROVED' WHERE id = p_entry;
  PERFORM app.write_audit('product.knowledge.approved', 'product_knowledge', p_entry::text, NULL, jsonb_build_object('version', v_next, 'note', trim(p_note)));
  RETURN v_version;
END $$;

-- Anyone who manages or reviews product knowledge may withdraw it at once (safety first).
CREATE FUNCTION app.product_knowledge_retire(p_entry uuid, p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT (app.has_permission('ai.clinical.review') OR app.has_permission('catalog.tetrasol.manage')) THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF p_note IS NULL OR length(trim(p_note)) < 3 THEN RAISE EXCEPTION 'NOTE_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  UPDATE app.product_knowledge SET status = 'RETIRED' WHERE id = p_entry AND status <> 'RETIRED';
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001'; END IF;
  UPDATE app.product_knowledge_versions SET superseded_at = now() WHERE entry_id = p_entry AND superseded_at IS NULL;
  PERFORM app.write_audit('product.knowledge.retired', 'product_knowledge', p_entry::text, NULL, jsonb_build_object('note', trim(p_note)));
END $$;

CREATE FUNCTION app.product_keyword_approve(p_keyword uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_k app.product_keywords;
BEGIN
  IF NOT app.has_permission('ai.clinical.review') THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_k FROM app.product_keywords WHERE id = p_keyword FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_k.status <> 'PENDING' THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001'; END IF;
  IF v_k.created_by_user_id = app.current_user_id() THEN RAISE EXCEPTION 'SELF_APPROVAL_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  UPDATE app.product_keywords SET status = 'APPROVED', approved_by_user_id = app.current_user_id(), approved_at = now() WHERE id = p_keyword;
  PERFORM app.write_audit('product.keyword.approved', 'product_keyword', p_keyword::text, NULL, jsonb_build_object('term', v_k.term));
END $$;

CREATE FUNCTION app.product_keyword_retire(p_keyword uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT (app.has_permission('ai.clinical.review') OR app.has_permission('catalog.tetrasol.manage')) THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  UPDATE app.product_keywords SET status = 'RETIRED', retired_at = now() WHERE id = p_keyword AND status <> 'RETIRED';
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001'; END IF;
  PERFORM app.write_audit('product.keyword.retired', 'product_keyword', p_keyword::text, NULL, '{}'::jsonb);
END $$;

-- ------------------------------------------------------------------ discovery
-- Live approved knowledge of products on sale is public product information.
CREATE POLICY product_knowledge_versions_read ON app.product_knowledge_versions FOR SELECT TO ghayarly_app
  USING ((superseded_at IS NULL AND app.product_visible(product_id))
         OR app.has_permission('catalog.tetrasol.manage') OR app.has_permission('ai.clinical.review'));
GRANT SELECT ON app.product_knowledge_versions TO ghayarly_app;

CREATE FUNCTION app.product_discovery_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce((SELECT enabled FROM app.feature_flags WHERE key = 'ai.product_discovery'), false)
      OR EXISTS (SELECT 1 FROM app.user_profiles WHERE user_id = app.current_user_id() AND account_kind = 'INTERNAL_TEST')
$$;

/*
 * Approved keywords found as whole words in a message, one row per product (an indication match
 * beats a name match; the longest term wins). Only approved, published, non-demo products the
 * caller can see; an indication keyword only while its indication has a live approved version.
 */
CREATE FUNCTION app.product_keyword_matches(p_query text)
RETURNS TABLE (product_id uuid, keyword_id uuid, term text, indication_version_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT DISTINCT ON (k.product_id) k.product_id, k.id, k.term, iv.id
  FROM app.product_keywords k
  JOIN app.products p ON p.id = k.product_id AND p.content_status = 'APPROVED' AND NOT p.is_demo
  LEFT JOIN app.product_knowledge e ON e.id = k.indication_id
  LEFT JOIN app.product_knowledge_versions iv ON iv.entry_id = k.indication_id AND iv.superseded_at IS NULL
  WHERE app.current_user_id() IS NOT NULL
    AND k.status = 'APPROVED'
    AND app.product_visible(k.product_id)
    AND (' ' || app.search_normalize(left(p_query, 2000)) || ' ') LIKE ('% ' || k.term_normalized || ' %')
    AND (k.indication_id IS NULL OR (iv.id IS NOT NULL AND e.status <> 'RETIRED'))
  ORDER BY k.product_id, (k.indication_id IS NOT NULL) DESC, length(k.term_normalized) DESC
$$;

-- What the assistant may use for this message: nothing unless discovery is on for the caller.
CREATE FUNCTION app.product_discovery(p_query text, p_limit int DEFAULT 2)
RETURNS TABLE (product_id uuid, keyword_id uuid, term text, indication_version_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT m.* FROM app.product_keyword_matches(p_query) m
  WHERE app.product_discovery_enabled()
  ORDER BY (m.indication_version_id IS NOT NULL) DESC, m.term
  LIMIT least(greatest(p_limit, 1), 2)
$$;

-- The keyword engine as staff see it (ignores the flag): which products a message would surface.
CREATE FUNCTION app.product_discovery_preview(p_query text)
RETURNS TABLE (product_id uuid, keyword_id uuid, term text, indication_version_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT (app.has_permission('catalog.tetrasol.manage') OR app.has_permission('ai.clinical.review')) THEN
    RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM app.product_keyword_matches(p_query);
END $$;

/*
 * Every company product name the answer checker must recognise (names of all products, approved
 * name keywords, brand names), normalised. Products not offered for a message must not appear in
 * its answer.
 */
CREATE FUNCTION app.product_name_terms()
RETURNS TABLE (product_id uuid, brand text, term text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT p.id, p.brand, app.search_normalize(n) FROM app.products p, unnest(ARRAY[p.name_ar, p.name_en]) AS n
  WHERE app.current_user_id() IS NOT NULL
  UNION
  SELECT k.product_id, p.brand, k.term_normalized FROM app.product_keywords k JOIN app.products p ON p.id = k.product_id
  WHERE app.current_user_id() IS NOT NULL AND k.status = 'APPROVED' AND k.indication_id IS NULL
  UNION
  SELECT NULL, b.name, app.search_normalize(b.name) FROM app.product_brands b WHERE app.current_user_id() IS NOT NULL
$$;

-- ------------------------------------------------------------------ products shown with an answer
CREATE TABLE app.ai_message_products (
  message_id uuid NOT NULL REFERENCES app.ai_messages (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES app.products (id) ON DELETE CASCADE,
  indication_version_id uuid REFERENCES app.product_knowledge_versions (id),
  label text NOT NULL CHECK (label ~ '^P[1-2]$'),
  PRIMARY KEY (message_id, product_id)
);
ALTER TABLE app.ai_message_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_message_products_own ON app.ai_message_products FOR SELECT TO ghayarly_app
  USING (EXISTS (SELECT 1 FROM app.ai_messages m WHERE m.id = message_id AND m.user_id = app.current_user_id()));
GRANT SELECT ON app.ai_message_products TO ghayarly_app;
-- The indication version shown with an answer stays readable to that person after it is superseded.
CREATE POLICY product_knowledge_versions_cited ON app.product_knowledge_versions FOR SELECT TO ghayarly_app
  USING (EXISTS (SELECT 1 FROM app.ai_message_products mp JOIN app.ai_messages m ON m.id = mp.message_id
                 WHERE mp.indication_version_id = product_knowledge_versions.id AND m.user_id = app.current_user_id()));

-- Attaches the products an answer cited (only to the caller's own, just-settled answer, and only
-- products that are still discoverable).
CREATE FUNCTION app.ai_attach_products(p_message uuid, p_products uuid[], p_versions uuid[], p_labels text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.ai_messages WHERE id = p_message AND user_id = app.current_user_id() AND role = 'assistant' AND created_at > clock_timestamp() - interval '5 minutes') THEN
    RAISE EXCEPTION 'AI_CONVERSATION_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF cardinality(p_products) <> cardinality(p_labels) OR cardinality(p_products) <> cardinality(p_versions) OR cardinality(p_products) > 2 THEN
    RAISE EXCEPTION 'INVALID_VALUE' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO app.ai_message_products (message_id, product_id, indication_version_id, label)
    SELECT p_message, x.p, (SELECT v.id FROM app.product_knowledge_versions v WHERE v.id = x.v AND v.product_id = x.p), x.l
    FROM unnest(p_products, p_versions, p_labels) AS x(p, v, l)
    WHERE app.product_discovery_enabled()
      AND EXISTS (SELECT 1 FROM app.products p WHERE p.id = x.p AND p.content_status = 'APPROVED' AND NOT p.is_demo AND app.product_visible(p.id))
  ON CONFLICT DO NOTHING;
END $$;

-- ------------------------------------------------------------------ rejected answers (assistant)
-- An answer the API refused to show: paid (cost recorded), not counted against the allowance.
CREATE FUNCTION app.ai_chat_reject(p_reservation uuid, p_provider app.ai_provider, p_served_model text, p_input_tokens int, p_output_tokens int, p_cache_read_tokens int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.ai_usage WHERE id = p_reservation AND user_id = app.current_user_id() AND route_key = 'patient.chat' AND status = 'RESERVED') THEN
    RAISE EXCEPTION 'AI_RESERVATION_INVALID' USING ERRCODE = 'P0001';
  END IF;
  PERFORM app.ai_usage_settle(p_reservation, p_provider, p_served_model, p_input_tokens, p_output_tokens, p_cache_read_tokens, 'INVALID_OUTPUT');
END $$;

-- Rejected answers in the last 24 hours (the API stops after 5 a day).
CREATE FUNCTION app.ai_rejections_today(p_route text) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT count(*)::int FROM app.ai_usage
  WHERE user_id = app.current_user_id() AND route_key = p_route AND outcome = 'INVALID_OUTPUT' AND reserved_at > clock_timestamp() - interval '24 hours'
$$;

REVOKE ALL ON FUNCTION app.product_knowledge_submit(uuid), app.product_knowledge_approve(uuid, text), app.product_knowledge_retire(uuid, text),
  app.product_keyword_approve(uuid), app.product_keyword_retire(uuid), app.product_discovery_enabled(), app.product_keyword_matches(text),
  app.product_discovery(text, int), app.product_discovery_preview(text), app.product_name_terms(),
  app.ai_attach_products(uuid, uuid[], uuid[], text[]), app.ai_chat_reject(uuid, app.ai_provider, text, int, int, int), app.ai_rejections_today(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.product_knowledge_submit(uuid), app.product_knowledge_approve(uuid, text), app.product_knowledge_retire(uuid, text),
  app.product_keyword_approve(uuid), app.product_keyword_retire(uuid), app.product_discovery_enabled(),
  app.product_discovery(text, int), app.product_discovery_preview(text), app.product_name_terms(),
  app.ai_attach_products(uuid, uuid[], uuid[], text[]), app.ai_chat_reject(uuid, app.ai_provider, text, int, int, int), app.ai_rejections_today(text) TO ghayarly_app;
