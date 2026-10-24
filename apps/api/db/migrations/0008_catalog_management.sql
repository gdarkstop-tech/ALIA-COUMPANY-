-- 0008 — Catalogue management for the Admin Console.
--
--   1. Permissions for this milestone (catalogue approval, brands, user status, AI configuration).
--   2. Company-owned brands: the store sells only brands the company owns (no competitors), but new
--      company product lines can be added by an administrator without an app update.
--   3. Product lifecycle: DRAFT → PUBLISHED ⇄ UNPUBLISHED → ARCHIVED. Publishing requires approved
--      content; editing medical text (uses, warnings, descriptions) sends an approved product back
--      to review and takes it off the store. Content is approved by a different person than the one
--      who last edited it (separation of duties).
--   4. Categories, product images (stored in the database, ≤ 2 MB, JPEG/PNG/WebP), stock quantities
--      with an append-only movement ledger, discounts, bundles.
--   5. Commerce analytics events (aggregate only — no user identifiers).

-- ------------------------------------------------------------------ 1. permissions
-- Mirrors ROLE_PERMISSIONS in packages/shared/src/roles.ts (consistency is asserted by tests).
CREATE OR REPLACE FUNCTION app.role_has_permission(p_role app.role, p_permission text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE p_role
    WHEN 'ADMIN' THEN p_permission = ANY (ARRAY[
      'provider.verification.review', 'provider.verification.decide', 'provider.capacity.manage_any',
      'catalog.tetrasol.manage', 'catalog.services.manage', 'audit.read', 'users.read', 'users.roles.grant',
      'catalog.content.approve', 'catalog.brands.manage', 'users.status.manage', 'users.appeals.decide',
      'ai.config.manage', 'ai.usage.read'])
    WHEN 'CLINICAL_REVIEWER' THEN p_permission = ANY (ARRAY['provider.verification.review', 'provider.verification.decide', 'catalog.content.approve'])
    WHEN 'SUPPORT' THEN p_permission = ANY (ARRAY['users.read', 'provider.verification.review'])
    WHEN 'TRUST_AND_SAFETY' THEN p_permission = ANY (ARRAY['audit.read', 'safety.reports.read', 'users.read', 'users.status.manage', 'users.appeals.decide'])
    WHEN 'COMMERCE_MANAGER' THEN p_permission = ANY (ARRAY['catalog.tetrasol.manage'])
    ELSE false
  END
$$;

-- ------------------------------------------------------------------ 2. company-owned brands
CREATE TABLE app.product_brands (
  name text PRIMARY KEY CHECK (length(name) BETWEEN 2 AND 60),
  owner_entity text NOT NULL CHECK (length(owner_entity) BETWEEN 2 AND 160),
  -- Evidence that the company owns the brand (trademark registration / group ownership record).
  ownership_reference text NOT NULL CHECK (length(ownership_reference) BETWEEN 3 AND 300),
  active boolean NOT NULL DEFAULT true,
  created_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- The owning entity and the ownership evidence have not been supplied yet: recorded as TO CONFIRM,
-- never asserted. An administrator replaces both once the brand owner provides them.
INSERT INTO app.product_brands (name, owner_entity, ownership_reference)
VALUES ('TetraSol', 'TO CONFIRM: legal owner of the TetraSol brand', 'TO CONFIRM: trademark registration / ownership record');

ALTER TABLE app.product_brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_brands_select ON app.product_brands FOR SELECT TO ghayarly_app
  USING (active OR app.has_permission('catalog.brands.manage') OR app.has_permission('catalog.tetrasol.manage'));
CREATE POLICY product_brands_write ON app.product_brands FOR ALL TO ghayarly_app
  USING (app.has_permission('catalog.brands.manage')) WITH CHECK (app.has_permission('catalog.brands.manage'));
GRANT SELECT, INSERT ON app.product_brands TO ghayarly_app;
GRANT UPDATE (active, owner_entity, ownership_reference) ON app.product_brands TO ghayarly_app;

-- The store stays single-owner by construction: a product's brand must be a company-owned brand.
ALTER TABLE app.products DROP CONSTRAINT products_brand_check;
ALTER TABLE app.products ALTER COLUMN brand DROP DEFAULT;
ALTER TABLE app.products ALTER COLUMN brand SET DEFAULT 'TetraSol';
ALTER TABLE app.products ADD CONSTRAINT products_brand_company_owned
  FOREIGN KEY (brand) REFERENCES app.product_brands (name) ON UPDATE CASCADE;

-- ------------------------------------------------------------------ 3. categories
CREATE TABLE app.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_ar text NOT NULL CHECK (length(name_ar) BETWEEN 1 AND 60),
  name_en text NOT NULL CHECK (length(name_en) BETWEEN 1 AND 60),
  sort_order int NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER product_categories_touch BEFORE UPDATE ON app.product_categories FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
ALTER TABLE app.product_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_categories_select ON app.product_categories FOR SELECT TO ghayarly_app
  USING (active OR app.has_permission('catalog.tetrasol.manage'));
CREATE POLICY product_categories_write ON app.product_categories FOR ALL TO ghayarly_app
  USING (app.has_permission('catalog.tetrasol.manage')) WITH CHECK (app.has_permission('catalog.tetrasol.manage'));
GRANT SELECT, INSERT, UPDATE ON app.product_categories TO ghayarly_app;

-- ------------------------------------------------------------------ 4. product lifecycle + approved content
CREATE TYPE app.publication_status AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED');
ALTER TABLE app.products
  ADD COLUMN category_id uuid REFERENCES app.product_categories (id) ON DELETE SET NULL,
  ADD COLUMN publication_status app.publication_status NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN approved_uses_ar text NOT NULL DEFAULT '' CHECK (length(approved_uses_ar) <= 2000),
  ADD COLUMN approved_uses_en text NOT NULL DEFAULT '' CHECK (length(approved_uses_en) <= 2000),
  ADD COLUMN warnings_ar text NOT NULL DEFAULT '' CHECK (length(warnings_ar) <= 2000),
  ADD COLUMN warnings_en text NOT NULL DEFAULT '' CHECK (length(warnings_en) <= 2000),
  ADD COLUMN published_at timestamptz,
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN created_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  ADD COLUMN updated_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL;
-- Existing rows keep their current visibility.
UPDATE app.products SET publication_status = 'PUBLISHED', published_at = coalesce(approved_at, now()) WHERE content_status = 'APPROVED' OR is_demo;
ALTER TABLE app.products ADD CONSTRAINT published_requires_approval
  CHECK (publication_status <> 'PUBLISHED' OR content_status = 'APPROVED' OR is_demo);

-- Visible to customers: approved, published, active company brand (plus labelled demo items in
-- demo mode / for review accounts, see 0006).
CREATE OR REPLACE FUNCTION app.product_visible(p_product uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.products p JOIN app.product_brands b ON b.name = p.brand
    WHERE p.id = p_product AND b.active AND p.publication_status = 'PUBLISHED'
      AND ((p.content_status = 'APPROVED' AND NOT p.is_demo) OR (p.is_demo AND (app.demo_visible() OR app.is_review_account())))
  )
$$;

/*
 * Catalogue guard (runs as the invoker so current_user identifies the API role):
 *   - new products start as DRAFT / PENDING_APPROVAL, whatever the client sends;
 *   - editing customer-facing medical text of an approved product returns it to review and takes it
 *     off the store;
 *   - approval needs catalog.content.approve, an approval reference, and a different person than
 *     the last editor;
 *   - synthetic (demo) flags cannot be changed.
 */
CREATE FUNCTION app.products_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
DECLARE
  v_actor text := app.current_user_id();
  v_text_changed boolean;
BEGIN
  IF current_user <> 'ghayarly_app' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.content_status := 'PENDING_APPROVAL';
    NEW.publication_status := 'DRAFT';
    NEW.approval_reference := NULL; NEW.approved_at := NULL; NEW.approved_by_user_id := NULL;
    NEW.published_at := NULL; NEW.archived_at := NULL;
    NEW.created_by_user_id := v_actor; NEW.updated_by_user_id := v_actor;
    RETURN NEW;
  END IF;

  IF NEW.is_demo IS DISTINCT FROM OLD.is_demo THEN RAISE EXCEPTION 'PROTECTED_FIELD' USING ERRCODE = '42501'; END IF;
  v_text_changed := (NEW.name_ar, NEW.name_en, NEW.summary_ar, NEW.summary_en, NEW.description_ar, NEW.description_en,
                     NEW.usage_ar, NEW.usage_en, NEW.approved_uses_ar, NEW.approved_uses_en, NEW.warnings_ar, NEW.warnings_en,
                     NEW.regulatory_note, NEW.brand)
    IS DISTINCT FROM (OLD.name_ar, OLD.name_en, OLD.summary_ar, OLD.summary_en, OLD.description_ar, OLD.description_en,
                      OLD.usage_ar, OLD.usage_en, OLD.approved_uses_ar, OLD.approved_uses_en, OLD.warnings_ar, OLD.warnings_en,
                      OLD.regulatory_note, OLD.brand);

  IF NEW.content_status = 'APPROVED' AND OLD.content_status <> 'APPROVED' THEN
    -- Approval transition (content must not change in the same step).
    IF v_text_changed THEN RAISE EXCEPTION 'APPROVE_WITHOUT_EDITING' USING ERRCODE = 'P0001'; END IF;
    IF NOT app.has_permission('catalog.content.approve') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
    IF coalesce(length(trim(NEW.approval_reference)), 0) < 3 THEN RAISE EXCEPTION 'APPROVAL_REFERENCE_REQUIRED' USING ERRCODE = 'P0001'; END IF;
    IF OLD.updated_by_user_id IS NOT NULL AND OLD.updated_by_user_id = v_actor THEN
      RAISE EXCEPTION 'APPROVER_MUST_DIFFER_FROM_EDITOR' USING ERRCODE = '42501';
    END IF;
    NEW.approved_by_user_id := v_actor;
    NEW.approved_at := now();
    PERFORM app.write_audit('catalog.product.content_approved', 'product', NEW.id::text, NULL,
      jsonb_build_object('approvalReference', NEW.approval_reference));
    -- (falls through: publishing in the same step is checked below; the editor of record stays
    -- the last person who changed the content)
  ELSIF NEW.content_status IS DISTINCT FROM OLD.content_status AND NEW.content_status <> 'PENDING_APPROVAL' THEN
    IF NOT app.has_permission('catalog.content.approve') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  END IF;

  IF v_text_changed AND OLD.content_status = 'APPROVED' THEN
    NEW.content_status := 'PENDING_APPROVAL';
    NEW.approval_reference := NULL; NEW.approved_at := NULL; NEW.approved_by_user_id := NULL;
    IF NEW.publication_status = 'PUBLISHED' THEN NEW.publication_status := 'UNPUBLISHED'; END IF;
    PERFORM app.write_audit('catalog.product.returned_to_review', 'product', NEW.id::text, NULL, '{}'::jsonb);
  END IF;

  -- Content that is no longer approved (withdrawn / rejected) leaves the store at once.
  IF NEW.content_status <> 'APPROVED' AND NEW.publication_status = 'PUBLISHED' AND NOT NEW.is_demo THEN
    NEW.publication_status := 'UNPUBLISHED';
  END IF;

  IF NEW.publication_status IS DISTINCT FROM OLD.publication_status THEN
    IF OLD.publication_status = 'ARCHIVED' AND NEW.publication_status NOT IN ('UNPUBLISHED', 'ARCHIVED') THEN
      RAISE EXCEPTION 'RESTORE_ARCHIVED_AS_UNPUBLISHED' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.publication_status = 'PUBLISHED' THEN NEW.published_at := now(); NEW.archived_at := NULL; END IF;
    IF NEW.publication_status = 'ARCHIVED' THEN NEW.archived_at := now(); END IF;
    IF NEW.publication_status = 'DRAFT' AND OLD.published_at IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_PUBLISHED_ONCE' USING ERRCODE = 'P0001'; END IF;
    PERFORM app.write_audit('catalog.product.' || lower(NEW.publication_status::text), 'product', NEW.id::text, NULL,
      jsonb_build_object('from', OLD.publication_status));
  END IF;
  NEW.updated_by_user_id := CASE WHEN v_text_changed OR NEW.category_id IS DISTINCT FROM OLD.category_id OR NEW.sort_order IS DISTINCT FROM OLD.sort_order
                                 THEN v_actor ELSE OLD.updated_by_user_id END;
  RETURN NEW;
END $$;
CREATE TRIGGER products_guard BEFORE INSERT OR UPDATE ON app.products FOR EACH ROW EXECUTE FUNCTION app.products_guard();

-- Only drafts that were never published may be deleted; everything else is archived.
DROP POLICY products_write ON app.products;
CREATE POLICY products_insert ON app.products FOR INSERT TO ghayarly_app
  WITH CHECK (app.has_permission('catalog.tetrasol.manage') AND NOT is_demo);
CREATE POLICY products_update ON app.products FOR UPDATE TO ghayarly_app
  USING (app.has_permission('catalog.tetrasol.manage') OR app.has_permission('catalog.content.approve'))
  WITH CHECK (app.has_permission('catalog.tetrasol.manage') OR app.has_permission('catalog.content.approve'));
CREATE POLICY products_delete ON app.products FOR DELETE TO ghayarly_app
  USING (app.has_permission('catalog.tetrasol.manage') AND publication_status = 'DRAFT' AND published_at IS NULL AND NOT is_demo);
DROP POLICY products_select ON app.products;
CREATE POLICY products_select ON app.products FOR SELECT TO ghayarly_app
  USING (app.product_visible(id) OR app.has_permission('catalog.tetrasol.manage') OR app.has_permission('catalog.content.approve'));
REVOKE UPDATE ON app.products FROM ghayarly_app;
GRANT UPDATE (name_ar, name_en, summary_ar, summary_en, description_ar, description_en, usage_ar, usage_en,
              approved_uses_ar, approved_uses_en, warnings_ar, warnings_en, regulatory_note, brand, category_id,
              sort_order, content_status, approval_reference, publication_status, updated_at) ON app.products TO ghayarly_app;
GRANT DELETE ON app.products TO ghayarly_app;

-- ------------------------------------------------------------------ 5. images
CREATE TABLE app.product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES app.products (id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 100 AND 2097152),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  width int CHECK (width IS NULL OR width BETWEEN 1 AND 10000),
  height int CHECK (height IS NULL OR height BETWEEN 1 AND 10000),
  alt_ar text NOT NULL DEFAULT '' CHECK (length(alt_ar) <= 200),
  alt_en text NOT NULL DEFAULT '' CHECK (length(alt_en) <= 200),
  sort_order int NOT NULL DEFAULT 100,
  created_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_images_product_idx ON app.product_images (product_id, sort_order);
ALTER TABLE app.product_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_images_select ON app.product_images FOR SELECT TO ghayarly_app
  USING (app.product_visible(product_id) OR app.has_permission('catalog.tetrasol.manage') OR app.has_permission('catalog.content.approve'));
CREATE POLICY product_images_write ON app.product_images FOR ALL TO ghayarly_app
  USING (app.has_permission('catalog.tetrasol.manage')) WITH CHECK (app.has_permission('catalog.tetrasol.manage'));
GRANT SELECT, INSERT, DELETE ON app.product_images TO ghayarly_app;
GRANT UPDATE (alt_ar, alt_en, sort_order) ON app.product_images TO ghayarly_app;

-- ------------------------------------------------------------------ 6. stock
ALTER TABLE app.product_variants
  ADD COLUMN stock_quantity int CHECK (stock_quantity IS NULL OR stock_quantity >= 0),
  ADD COLUMN low_stock_threshold int NOT NULL DEFAULT 5 CHECK (low_stock_threshold BETWEEN 0 AND 100000);
REVOKE UPDATE ON app.product_variants FROM ghayarly_app;
-- stock_quantity changes only through app.adjust_stock (ledgered).
GRANT UPDATE (label_ar, label_en, price_piasters, stock_status, active, sort_order, low_stock_threshold, updated_at) ON app.product_variants TO ghayarly_app;

CREATE TYPE app.stock_reason AS ENUM ('INITIAL', 'RESTOCK', 'SALE', 'RETURN', 'DAMAGE', 'CORRECTION');
CREATE TABLE app.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES app.product_variants (id) ON DELETE CASCADE,
  delta int NOT NULL CHECK (delta <> 0),
  quantity_after int NOT NULL CHECK (quantity_after >= 0),
  reason app.stock_reason NOT NULL,
  note text CHECK (note IS NULL OR length(note) <= 300),
  actor_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX stock_movements_variant_idx ON app.stock_movements (variant_id, created_at DESC);
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON app.stock_movements FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
ALTER TABLE app.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_movements_select ON app.stock_movements FOR SELECT TO ghayarly_app USING (app.has_permission('catalog.tetrasol.manage'));
GRANT SELECT ON app.stock_movements TO ghayarly_app;

CREATE FUNCTION app.stock_status_for(p_quantity int, p_threshold int) RETURNS app.stock_status
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_quantity IS NULL THEN 'UNKNOWN'::app.stock_status
              WHEN p_quantity = 0 THEN 'OUT_OF_STOCK'::app.stock_status
              WHEN p_quantity <= p_threshold THEN 'LOW_STOCK'::app.stock_status
              ELSE 'IN_STOCK'::app.stock_status END
$$;

CREATE FUNCTION app.adjust_stock(p_variant uuid, p_delta int, p_reason app.stock_reason, p_note text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_qty int;
  v_threshold int;
BEGIN
  IF NOT app.has_permission('catalog.tetrasol.manage') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF p_delta = 0 THEN RAISE EXCEPTION 'ZERO_ADJUSTMENT' USING ERRCODE = 'P0001'; END IF;
  SELECT coalesce(stock_quantity, 0), low_stock_threshold INTO v_qty, v_threshold FROM app.product_variants WHERE id = p_variant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VARIANT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_qty := v_qty + p_delta;
  IF v_qty < 0 THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING ERRCODE = 'P0001'; END IF;
  UPDATE app.product_variants SET stock_quantity = v_qty, stock_status = app.stock_status_for(v_qty, v_threshold) WHERE id = p_variant;
  INSERT INTO app.stock_movements (variant_id, delta, quantity_after, reason, note, actor_user_id)
  VALUES (p_variant, p_delta, v_qty, p_reason, nullif(trim(p_note), ''), app.current_user_id());
  PERFORM app.write_audit('catalog.stock.adjusted', 'product_variant', p_variant::text, NULL,
    jsonb_build_object('delta', p_delta, 'quantityAfter', v_qty, 'reason', p_reason));
  RETURN v_qty;
END $$;

-- A tracked variant's status always follows its quantity (threshold edits included).
CREATE FUNCTION app.product_variants_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  -- Quantities enter only through app.adjust_stock (ledgered), never with a new variant.
  IF TG_OP = 'INSERT' THEN
    IF current_user = 'ghayarly_app' THEN NEW.stock_quantity := NULL; END IF;
    RETURN NEW;
  END IF;
  IF NEW.stock_quantity IS NOT NULL THEN NEW.stock_status := app.stock_status_for(NEW.stock_quantity, NEW.low_stock_threshold); END IF;
  IF current_user = 'ghayarly_app' AND NEW.price_piasters IS DISTINCT FROM OLD.price_piasters THEN
    PERFORM app.write_audit('catalog.price.changed', 'product_variant', NEW.id::text, NULL,
      jsonb_build_object('from', OLD.price_piasters, 'to', NEW.price_piasters));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_variants_guard BEFORE INSERT OR UPDATE ON app.product_variants FOR EACH ROW EXECUTE FUNCTION app.product_variants_guard();

-- ------------------------------------------------------------------ 7. discounts
CREATE TYPE app.discount_kind AS ENUM ('PERCENT', 'FIXED_AMOUNT');
CREATE TYPE app.discount_scope AS ENUM ('ALL', 'CATEGORY', 'PRODUCT', 'VARIANT', 'BUNDLE');
CREATE TABLE app.discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar text NOT NULL CHECK (length(name_ar) BETWEEN 1 AND 80),
  name_en text NOT NULL CHECK (length(name_en) BETWEEN 1 AND 80),
  -- NULL = applied automatically; otherwise the customer enters the code at checkout.
  code text UNIQUE CHECK (code IS NULL OR code ~ '^[A-Z0-9-]{4,24}$'),
  kind app.discount_kind NOT NULL,
  value int NOT NULL CHECK (value > 0),
  scope app.discount_scope NOT NULL,
  target_id uuid,
  min_subtotal_piasters int NOT NULL DEFAULT 0 CHECK (min_subtotal_piasters >= 0),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT false,
  created_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discount_percent_range CHECK (kind <> 'PERCENT' OR value BETWEEN 1 AND 90),
  CONSTRAINT discount_target CHECK ((scope = 'ALL') = (target_id IS NULL)),
  CONSTRAINT discount_window CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE TRIGGER discounts_touch BEFORE UPDATE ON app.discounts FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
ALTER TABLE app.discounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY discounts_manage ON app.discounts FOR ALL TO ghayarly_app
  USING (app.has_permission('catalog.tetrasol.manage')) WITH CHECK (app.has_permission('catalog.tetrasol.manage'));
GRANT SELECT, INSERT, UPDATE ON app.discounts TO ghayarly_app;

-- Discounts a checkout may apply right now: automatic ones plus the one matching p_code.
-- Codes are never listable by customers.
CREATE FUNCTION app.applicable_discounts(p_code text) RETURNS SETOF app.discounts
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT * FROM app.discounts
  WHERE active AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
    AND (code IS NULL OR (p_code IS NOT NULL AND code = upper(trim(p_code))))
$$;

-- ------------------------------------------------------------------ 8. bundles
CREATE TABLE app.product_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_ar text NOT NULL CHECK (length(name_ar) BETWEEN 1 AND 120),
  name_en text NOT NULL CHECK (length(name_en) BETWEEN 1 AND 120),
  description_ar text NOT NULL DEFAULT '' CHECK (length(description_ar) <= 1000),
  description_en text NOT NULL DEFAULT '' CHECK (length(description_en) <= 1000),
  price_piasters int NOT NULL CHECK (price_piasters > 0),
  publication_status app.publication_status NOT NULL DEFAULT 'DRAFT',
  published_at timestamptz,
  created_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER product_bundles_touch BEFORE UPDATE ON app.product_bundles FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TABLE app.product_bundle_items (
  bundle_id uuid NOT NULL REFERENCES app.product_bundles (id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES app.product_variants (id) ON DELETE RESTRICT,
  quantity int NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  PRIMARY KEY (bundle_id, variant_id)
);

-- A bundle is visible only while it is published and every item in it is itself on sale.
CREATE FUNCTION app.bundle_visible(p_bundle uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM app.product_bundles b WHERE b.id = p_bundle AND b.publication_status = 'PUBLISHED')
    AND EXISTS (SELECT 1 FROM app.product_bundle_items i WHERE i.bundle_id = p_bundle)
    AND NOT EXISTS (
      SELECT 1 FROM app.product_bundle_items i JOIN app.product_variants v ON v.id = i.variant_id
      WHERE i.bundle_id = p_bundle AND (NOT v.active OR NOT app.product_visible(v.product_id)))
$$;

CREATE FUNCTION app.product_bundles_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN NEW.publication_status := 'DRAFT'; NEW.published_at := NULL; NEW.created_by_user_id := app.current_user_id(); RETURN NEW; END IF;
  IF NEW.publication_status = 'PUBLISHED' AND OLD.publication_status <> 'PUBLISHED' THEN
    IF NOT EXISTS (SELECT 1 FROM app.product_bundle_items WHERE bundle_id = NEW.id)
       OR EXISTS (SELECT 1 FROM app.product_bundle_items i JOIN app.product_variants v ON v.id = i.variant_id
                  WHERE i.bundle_id = NEW.id AND (NOT v.active OR NOT app.product_visible(v.product_id))) THEN
      RAISE EXCEPTION 'BUNDLE_ITEMS_NOT_ON_SALE' USING ERRCODE = 'P0001';
    END IF;
    NEW.published_at := now();
  END IF;
  IF NEW.publication_status IS DISTINCT FROM OLD.publication_status THEN
    PERFORM app.write_audit('catalog.bundle.' || lower(NEW.publication_status::text), 'bundle', NEW.id::text, NULL, '{}'::jsonb);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_bundles_guard BEFORE INSERT OR UPDATE ON app.product_bundles FOR EACH ROW EXECUTE FUNCTION app.product_bundles_guard();

ALTER TABLE app.product_bundles ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_bundles_select ON app.product_bundles FOR SELECT TO ghayarly_app
  USING (app.bundle_visible(id) OR app.has_permission('catalog.tetrasol.manage'));
CREATE POLICY product_bundles_write ON app.product_bundles FOR ALL TO ghayarly_app
  USING (app.has_permission('catalog.tetrasol.manage')) WITH CHECK (app.has_permission('catalog.tetrasol.manage'));
GRANT SELECT, INSERT, UPDATE ON app.product_bundles TO ghayarly_app;
ALTER TABLE app.product_bundle_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_bundle_items_select ON app.product_bundle_items FOR SELECT TO ghayarly_app
  USING (app.bundle_visible(bundle_id) OR app.has_permission('catalog.tetrasol.manage'));
CREATE POLICY product_bundle_items_write ON app.product_bundle_items FOR ALL TO ghayarly_app
  USING (app.has_permission('catalog.tetrasol.manage')
         AND (SELECT publication_status FROM app.product_bundles WHERE id = bundle_id) <> 'PUBLISHED')
  WITH CHECK (app.has_permission('catalog.tetrasol.manage')
         AND (SELECT publication_status FROM app.product_bundles WHERE id = bundle_id) <> 'PUBLISHED');
GRANT SELECT, INSERT, UPDATE, DELETE ON app.product_bundle_items TO ghayarly_app;

-- Cart lines are either a variant or a bundle.
ALTER TABLE app.cart_items ALTER COLUMN variant_id DROP NOT NULL;
ALTER TABLE app.cart_items ADD COLUMN bundle_id uuid REFERENCES app.product_bundles (id) ON DELETE CASCADE;
ALTER TABLE app.cart_items ADD CONSTRAINT cart_item_kind CHECK (num_nonnulls(variant_id, bundle_id) = 1);
DROP INDEX app.cart_items_unique;
CREATE UNIQUE INDEX cart_items_unique ON app.cart_items (user_id, coalesce(variant_id, bundle_id), coalesce(for_patient_id, '00000000-0000-0000-0000-000000000000'::uuid));
DROP POLICY cart_items_own ON app.cart_items;
CREATE POLICY cart_items_own ON app.cart_items FOR ALL TO ghayarly_app
  USING (user_id = app.current_user_id())
  WITH CHECK (
    user_id = app.current_user_id()
    AND (for_patient_id IS NULL OR app.can_view_patient(for_patient_id))
    AND (
      (variant_id IS NOT NULL AND EXISTS (SELECT 1 FROM app.product_variants v WHERE v.id = variant_id AND v.active AND app.product_visible(v.product_id)))
      OR (bundle_id IS NOT NULL AND app.bundle_visible(bundle_id))
    )
  );

-- ------------------------------------------------------------------ 9. commerce analytics events (aggregate, no user ids)
CREATE TYPE app.commerce_event_type AS ENUM ('PRODUCT_VIEW', 'ADD_TO_CART', 'CHECKOUT_PREVIEW', 'ORDER_PAID', 'ORDER_REFUNDED');
CREATE TABLE app.commerce_events (
  id bigserial PRIMARY KEY,
  event_type app.commerce_event_type NOT NULL,
  product_id uuid REFERENCES app.products (id) ON DELETE SET NULL,
  variant_id uuid REFERENCES app.product_variants (id) ON DELETE SET NULL,
  bundle_id uuid REFERENCES app.product_bundles (id) ON DELETE SET NULL,
  quantity int NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 1000),
  amount_piasters int CHECK (amount_piasters IS NULL OR amount_piasters >= 0),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commerce_events_time_idx ON app.commerce_events (occurred_at, event_type);
CREATE TRIGGER commerce_events_append_only BEFORE UPDATE OR DELETE ON app.commerce_events FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
ALTER TABLE app.commerce_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY commerce_events_select ON app.commerce_events FOR SELECT TO ghayarly_app USING (app.has_permission('catalog.tetrasol.manage'));
GRANT SELECT ON app.commerce_events TO ghayarly_app;

-- Customers' apps may record only funnel events, and only for products they can see. Paid orders
-- are recorded by the payment integration when one exists.
CREATE FUNCTION app.record_commerce_event(p_type app.commerce_event_type, p_product uuid, p_variant uuid, p_bundle uuid, p_quantity int, p_amount int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF p_type NOT IN ('PRODUCT_VIEW', 'ADD_TO_CART', 'CHECKOUT_PREVIEW') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF p_product IS NOT NULL AND NOT app.product_visible(p_product) THEN RETURN; END IF;
  IF p_bundle IS NOT NULL AND NOT app.bundle_visible(p_bundle) THEN RETURN; END IF;
  INSERT INTO app.commerce_events (event_type, product_id, variant_id, bundle_id, quantity, amount_piasters)
  VALUES (p_type, p_product, p_variant, p_bundle, greatest(1, least(coalesce(p_quantity, 1), 1000)), p_amount);
END $$;

REVOKE ALL ON FUNCTION app.adjust_stock(uuid, int, app.stock_reason, text), app.applicable_discounts(text), app.bundle_visible(uuid),
  app.record_commerce_event(app.commerce_event_type, uuid, uuid, uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.adjust_stock(uuid, int, app.stock_reason, text), app.applicable_discounts(text), app.bundle_visible(uuid),
  app.record_commerce_event(app.commerce_event_type, uuid, uuid, uuid, int, int) TO ghayarly_app;
