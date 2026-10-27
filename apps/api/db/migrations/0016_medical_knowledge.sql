-- 0016 — Curated medical knowledge for DMW Medical AI (retrieval with citations).
--
--   * Articles are written by knowledge editors and become live only when a clinical reviewer
--     (ai.clinical.review) who did not write that revision approves it. Each approval is an
--     immutable version recording who approved it and when; editing an approved article starts a
--     new draft while the approved version stays live.
--   * Every article cites its source (publisher, title, optional link and date). The assistant may
--     only cite retrieved, approved versions; retrieval never returns drafts or retired articles.
--   * Search is PostgreSQL full-text search over text normalised for Arabic and English (no
--     embeddings, no external service). Article text is data for the model, never instructions.

-- ------------------------------------------------------------------ permissions
CREATE OR REPLACE FUNCTION app.role_has_permission(p_role app.role, p_permission text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE p_role
    WHEN 'ADMIN' THEN p_permission = ANY (ARRAY[
      'provider.verification.review', 'provider.verification.decide', 'provider.capacity.manage_any',
      'catalog.tetrasol.manage', 'catalog.services.manage', 'audit.read', 'users.read', 'users.roles.grant',
      'catalog.content.approve', 'catalog.brands.manage', 'users.status.manage', 'users.appeals.decide',
      'ai.config.manage', 'ai.usage.read', 'ai.eval.manage', 'ai.data.approve', 'knowledge.manage'])
    WHEN 'CLINICAL_REVIEWER' THEN p_permission = ANY (ARRAY['provider.verification.review', 'provider.verification.decide', 'catalog.content.approve', 'ai.clinical.review', 'ai.safety.review', 'knowledge.manage'])
    WHEN 'SUPPORT' THEN p_permission = ANY (ARRAY['users.read', 'provider.verification.review'])
    WHEN 'TRUST_AND_SAFETY' THEN p_permission = ANY (ARRAY['audit.read', 'safety.reports.read', 'users.read', 'users.status.manage', 'users.appeals.decide', 'ai.safety.review'])
    WHEN 'COMMERCE_MANAGER' THEN p_permission = ANY (ARRAY['catalog.tetrasol.manage'])
    ELSE false
  END
$$;

-- ------------------------------------------------------------------ normalisation for search (Arabic + English)
-- Lower case; Arabic diacritics and tatweel removed; alef / yaa / taa marbuta / hamza seats
-- unified; punctuation to spaces; the attached article (ال، وال، بال، كال، فال، لل) stripped.
CREATE FUNCTION app.search_normalize(p text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        translate(
          regexp_replace(lower(coalesce(p, '')), '[ً-ٰٟـ]', '', 'g'),
          'أإآٱىةؤئ٠١٢٣٤٥٦٧٨٩', 'اااايهوي0123456789'),
        '[^[:alnum:]ء-ي]+', ' ', 'g'),
      '(^| )(وبال|وكال|وال|بال|كال|فال|ولل|لل|ال)([^ ]{2,})', '\1\3', 'g'),
    ' +', ' ', 'g'))
$$;

-- ------------------------------------------------------------------ articles (working copies) and approved versions
CREATE TABLE app.knowledge_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  locale text NOT NULL CHECK (locale IN ('ar', 'en')),
  title text NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 500),
  body text NOT NULL CHECK (length(body) BETWEEN 50 AND 20000),
  topics text[] NOT NULL DEFAULT '{}' CHECK (cardinality(topics) <= 20),
  source_publisher text NOT NULL CHECK (length(source_publisher) BETWEEN 2 AND 200),
  source_title text NOT NULL CHECK (length(source_title) BETWEEN 2 AND 300),
  source_url text CHECK (source_url IS NULL OR source_url ~ '^https://[^ ]{4,500}$'),
  source_date date,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'RETIRED')),
  edited_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug, locale)
);
CREATE TRIGGER knowledge_articles_touch BEFORE UPDATE ON app.knowledge_articles FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE app.knowledge_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES app.knowledge_articles (id) ON DELETE CASCADE,
  version int NOT NULL,
  locale text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  body text NOT NULL,
  topics text[] NOT NULL,
  source_publisher text NOT NULL,
  source_title text NOT NULL,
  source_url text,
  source_date date,
  edited_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  approved_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  approval_note text NOT NULL CHECK (length(approval_note) BETWEEN 3 AND 1000),
  superseded_at timestamptz,
  UNIQUE (article_id, version)
);
CREATE UNIQUE INDEX knowledge_versions_one_live ON app.knowledge_versions (article_id) WHERE superseded_at IS NULL;
-- Approved text never changes; only superseded_at is set when a newer version goes live.
CREATE FUNCTION app.knowledge_versions_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.article_id, NEW.version, NEW.title, NEW.summary, NEW.body, NEW.topics, NEW.source_publisher, NEW.source_title, NEW.source_url, NEW.source_date, NEW.approved_by_user_id, NEW.approved_at, NEW.approval_note)
     IS DISTINCT FROM (OLD.article_id, OLD.version, OLD.title, OLD.summary, OLD.body, OLD.topics, OLD.source_publisher, OLD.source_title, OLD.source_url, OLD.source_date, OLD.approved_by_user_id, OLD.approved_at, OLD.approval_note)
     OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at) THEN
    RAISE EXCEPTION 'knowledge_versions is append-only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER knowledge_versions_immutable BEFORE UPDATE ON app.knowledge_versions FOR EACH ROW EXECUTE FUNCTION app.knowledge_versions_immutable();
CREATE TRIGGER knowledge_versions_no_delete BEFORE DELETE ON app.knowledge_versions FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

CREATE TABLE app.knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES app.knowledge_versions (id) ON DELETE CASCADE,
  ordinal int NOT NULL,
  content text NOT NULL,
  tsv tsvector NOT NULL,
  UNIQUE (version_id, ordinal)
);
CREATE INDEX knowledge_chunks_tsv ON app.knowledge_chunks USING gin (tsv);

-- Editing content makes the working copy a draft again (the approved version stays live).
CREATE FUNCTION app.knowledge_articles_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  IF current_user <> 'ghayarly_app' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'DRAFT'; NEW.edited_by_user_id := app.current_user_id();
  ELSIF (NEW.slug, NEW.locale, NEW.title, NEW.summary, NEW.body, NEW.topics, NEW.source_publisher, NEW.source_title, NEW.source_url, NEW.source_date)
        IS DISTINCT FROM (OLD.slug, OLD.locale, OLD.title, OLD.summary, OLD.body, OLD.topics, OLD.source_publisher, OLD.source_title, OLD.source_url, OLD.source_date) THEN
    IF OLD.status = 'RETIRED' THEN RAISE EXCEPTION 'KNOWLEDGE_RETIRED' USING ERRCODE = 'P0001'; END IF;
    NEW.status := 'DRAFT'; NEW.edited_by_user_id := app.current_user_id();
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'USE_WORKFLOW_FUNCTIONS' USING ERRCODE = '42501';
  END IF;
  PERFORM app.write_audit('knowledge.article.' || lower(TG_OP), 'knowledge_article', NEW.id::text, NULL, jsonb_build_object('slug', NEW.slug, 'locale', NEW.locale));
  RETURN NEW;
END $$;
CREATE TRIGGER knowledge_articles_guard BEFORE INSERT OR UPDATE ON app.knowledge_articles FOR EACH ROW EXECUTE FUNCTION app.knowledge_articles_guard();

ALTER TABLE app.knowledge_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.knowledge_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.knowledge_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY knowledge_articles_read ON app.knowledge_articles FOR SELECT TO ghayarly_app USING (app.has_permission('knowledge.manage') OR app.has_permission('ai.clinical.review'));
CREATE POLICY knowledge_articles_insert ON app.knowledge_articles FOR INSERT TO ghayarly_app WITH CHECK (app.has_permission('knowledge.manage'));
CREATE POLICY knowledge_articles_update ON app.knowledge_articles FOR UPDATE TO ghayarly_app USING (app.has_permission('knowledge.manage')) WITH CHECK (app.has_permission('knowledge.manage'));
GRANT SELECT, INSERT ON app.knowledge_articles TO ghayarly_app;
GRANT UPDATE (slug, locale, title, summary, body, topics, source_publisher, source_title, source_url, source_date, updated_at) ON app.knowledge_articles TO ghayarly_app;
GRANT SELECT ON app.knowledge_versions TO ghayarly_app;
-- Chunks: only through app.knowledge_search().

-- ------------------------------------------------------------------ workflow
CREATE FUNCTION app.knowledge_submit(p_article uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT app.has_permission('knowledge.manage') THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  UPDATE app.knowledge_articles SET status = 'IN_REVIEW' WHERE id = p_article AND status = 'DRAFT';
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001'; END IF;
  PERFORM app.write_audit('knowledge.article.submitted', 'knowledge_article', p_article::text, NULL, '{}'::jsonb);
END $$;

-- A clinical reviewer who did not write this revision makes it the live version.
CREATE FUNCTION app.knowledge_approve(p_article uuid, p_note text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_a app.knowledge_articles;
  v_next int;
  v_version uuid;
BEGIN
  IF NOT app.has_permission('ai.clinical.review') THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF p_note IS NULL OR length(trim(p_note)) < 3 THEN RAISE EXCEPTION 'NOTE_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_a FROM app.knowledge_articles WHERE id = p_article FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_a.status <> 'IN_REVIEW' THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001'; END IF;
  IF v_a.edited_by_user_id = app.current_user_id() THEN RAISE EXCEPTION 'SELF_APPROVAL_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM app.knowledge_versions WHERE article_id = p_article;
  UPDATE app.knowledge_versions SET superseded_at = now() WHERE article_id = p_article AND superseded_at IS NULL;
  INSERT INTO app.knowledge_versions (article_id, version, locale, title, summary, body, topics, source_publisher, source_title, source_url, source_date, edited_by_user_id, approved_by_user_id, approval_note)
  VALUES (p_article, v_next, v_a.locale, v_a.title, v_a.summary, v_a.body, v_a.topics, v_a.source_publisher, v_a.source_title, v_a.source_url, v_a.source_date, v_a.edited_by_user_id, app.current_user_id(), trim(p_note))
  RETURNING id INTO v_version;
  -- Paragraph chunks; title and topics are indexed with each so short paragraphs stay findable.
  INSERT INTO app.knowledge_chunks (version_id, ordinal, content, tsv)
    SELECT v_version, p.ord, trim(p.para),
           to_tsvector('simple', app.search_normalize(v_a.title || ' ' || array_to_string(v_a.topics, ' ') || ' ' || p.para))
    FROM regexp_split_to_table(v_a.body, '\n\s*\n') WITH ORDINALITY AS p(para, ord)
    WHERE length(trim(p.para)) > 0;
  UPDATE app.knowledge_articles SET status = 'APPROVED' WHERE id = p_article;
  PERFORM app.write_audit('knowledge.article.approved', 'knowledge_article', p_article::text, NULL, jsonb_build_object('version', v_next, 'note', trim(p_note)));
  RETURN v_version;
END $$;

CREATE FUNCTION app.knowledge_retire(p_article uuid, p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT (app.has_permission('ai.clinical.review') OR app.has_permission('knowledge.manage')) THEN RAISE EXCEPTION 'PERMISSION_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF p_note IS NULL OR length(trim(p_note)) < 3 THEN RAISE EXCEPTION 'NOTE_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  UPDATE app.knowledge_articles SET status = 'RETIRED' WHERE id = p_article AND status <> 'RETIRED';
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001'; END IF;
  UPDATE app.knowledge_versions SET superseded_at = now() WHERE article_id = p_article AND superseded_at IS NULL;
  PERFORM app.write_audit('knowledge.article.retired', 'knowledge_article', p_article::text, NULL, jsonb_build_object('note', trim(p_note)));
END $$;

-- ------------------------------------------------------------------ retrieval
/*
 * Approved, live passages for a question, best first (same language first). A passage must
 * contain at least half of the question's significant terms.
 */
CREATE FUNCTION app.knowledge_search(p_query text, p_locale text, p_limit int DEFAULT 3)
RETURNS TABLE (chunk_id uuid, version_id uuid, article_id uuid, slug text, locale text, version int, title text, content text,
               source_publisher text, source_title text, source_url text, source_date date, rank real)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  WITH stop AS (
    SELECT app.search_normalize(x) AS w FROM unnest(ARRAY[
      'the', 'and', 'what', 'how', 'does', 'with', 'for', 'this', 'that', 'are', 'you', 'your', 'can', 'should', 'from', 'have', 'has',
      'about', 'when', 'why', 'which', 'into', 'there', 'their', 'they', 'was', 'were', 'will', 'would', 'could', 'mean', 'means', 'tell',
      'please', 'need', 'want', 'know', 'some', 'any', 'get', 'got', 'its', 'our', 'his', 'her', 'him', 'she', 'not', 'but', 'all', 'one', 'often',
      'ماذا', 'كيف', 'على', 'إلى', 'هذا', 'هذه', 'إيه', 'يعني', 'اللي', 'عندي', 'عنده', 'عندها', 'لكن', 'أنا', 'إزاي', 'ليه', 'إمتى', 'امتى', 'متى',
      'كده', 'كدا', 'دلوقتي', 'ممكن', 'عايز', 'عايزة', 'محتاج', 'محتاجة', 'بتاع', 'بتاعي', 'بتاعتي', 'أيضا', 'جدا', 'لما', 'إذا', 'عشان', 'ينفع']) AS x
  ), terms AS (
    -- Each significant word, plus a light variant without an Arabic imperfect-verb prefix
    -- (أغير / تغير / يغير → غير), so a question matches the article's verb forms.
    SELECT DISTINCT w,
           CASE WHEN w ~ '^[اتين][ء-ي]{3,}$' THEN substr(w, 2) END AS alt
    FROM regexp_split_to_table(app.search_normalize(left(p_query, 2000)), ' ') AS w
    WHERE length(w) >= 3 AND w NOT IN (SELECT w FROM stop)
    LIMIT 24
  ), q AS (
    SELECT (SELECT count(*) FROM terms) AS n,
           to_tsquery('simple', (SELECT string_agg(quote_literal(w) || ':*' || coalesce(' | ' || quote_literal(alt) || ':*', ''), ' | ') FROM terms)) AS t
  )
  SELECT c.id, v.id, v.article_id, a.slug, v.locale, v.version, v.title, c.content, v.source_publisher, v.source_title, v.source_url, v.source_date,
         ts_rank(c.tsv, q.t) AS rank
  FROM q
  JOIN app.knowledge_chunks c ON q.n > 0 AND c.tsv @@ q.t
  JOIN app.knowledge_versions v ON v.id = c.version_id AND v.superseded_at IS NULL
  JOIN app.knowledge_articles a ON a.id = v.article_id AND a.status <> 'RETIRED'
  WHERE app.current_user_id() IS NOT NULL
    -- At least half of the significant terms (rounded up) must appear in the passage.
    AND (SELECT count(*) FROM terms t
         WHERE c.tsv @@ to_tsquery('simple', quote_literal(t.w) || ':*' || coalesce(' | ' || quote_literal(t.alt) || ':*', ''))) >= ceil(q.n / 2.0)
  ORDER BY (v.locale = p_locale) DESC, rank DESC, c.ordinal
  LIMIT least(greatest(p_limit, 1), 5)
$$;

-- ------------------------------------------------------------------ citations on assistant answers
CREATE TABLE app.ai_message_citations (
  message_id uuid NOT NULL REFERENCES app.ai_messages (id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES app.knowledge_versions (id),
  label text NOT NULL CHECK (label ~ '^K[1-5]$'),
  PRIMARY KEY (message_id, version_id)
);
ALTER TABLE app.ai_message_citations ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_message_citations_own ON app.ai_message_citations FOR SELECT TO ghayarly_app
  USING (EXISTS (SELECT 1 FROM app.ai_messages m WHERE m.id = message_id AND m.user_id = app.current_user_id()));
GRANT SELECT ON app.ai_message_citations TO ghayarly_app;

-- Live versions are readable by any signed-in person; a version an answer cited stays readable to
-- that person after it is superseded; editors and reviewers see every version.
CREATE POLICY knowledge_versions_read ON app.knowledge_versions FOR SELECT TO ghayarly_app
  USING ((app.current_user_id() IS NOT NULL AND superseded_at IS NULL)
         OR EXISTS (SELECT 1 FROM app.ai_message_citations c JOIN app.ai_messages m ON m.id = c.message_id
                    WHERE c.version_id = knowledge_versions.id AND m.user_id = app.current_user_id())
         OR app.has_permission('knowledge.manage') OR app.has_permission('ai.clinical.review'));

-- Attaches the approved versions an answer cited (only to the caller's own, just-settled answer).
CREATE FUNCTION app.ai_attach_citations(p_message uuid, p_versions uuid[], p_labels text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.ai_messages WHERE id = p_message AND user_id = app.current_user_id() AND role = 'assistant' AND created_at > clock_timestamp() - interval '5 minutes') THEN
    RAISE EXCEPTION 'AI_CONVERSATION_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF cardinality(p_versions) <> cardinality(p_labels) OR cardinality(p_versions) > 5 THEN RAISE EXCEPTION 'INVALID_CITATIONS' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO app.ai_message_citations (message_id, version_id, label)
    SELECT p_message, v, l FROM unnest(p_versions, p_labels) AS x(v, l)
    WHERE EXISTS (SELECT 1 FROM app.knowledge_versions kv WHERE kv.id = x.v)
  ON CONFLICT DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION app.search_normalize(text), app.knowledge_submit(uuid), app.knowledge_approve(uuid, text), app.knowledge_retire(uuid, text),
  app.knowledge_search(text, text, int), app.ai_attach_citations(uuid, uuid[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.search_normalize(text), app.knowledge_submit(uuid), app.knowledge_approve(uuid, text), app.knowledge_retire(uuid, text),
  app.knowledge_search(text, text, int), app.ai_attach_citations(uuid, uuid[], text[]) TO ghayarly_app;
