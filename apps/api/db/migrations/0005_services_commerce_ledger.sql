-- 0005 — Nursing service catalog, provider services, TetraSol-only commerce, provider ledger.

CREATE TYPE app.stock_status AS ENUM ('IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'UNKNOWN');
CREATE TYPE app.content_approval_status AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'RETIRED');
CREATE TYPE app.ledger_entry_type AS ENUM ('VISIT_EARNING', 'PLATFORM_FEE', 'ADJUSTMENT', 'PAYOUT');
CREATE TYPE app.ledger_status AS ENUM ('PENDING', 'AVAILABLE', 'PAID_OUT');

-- ------------------------------------------------------------------ nursing services (configurable)
CREATE TABLE app.nursing_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z][A-Z0-9_]{2,40}$'),
  name_ar text NOT NULL,
  name_en text NOT NULL,
  description_ar text NOT NULL,
  description_en text NOT NULL,
  -- What the service includes and excludes (clinical scope).
  scope_ar text NOT NULL,
  scope_en text NOT NULL,
  eligible_provider_types app.provider_type[] NOT NULL DEFAULT '{NURSE}',
  duration_minutes int NOT NULL CHECK (duration_minutes BETWEEN 10 AND 720),
  base_price_piasters int NOT NULL CHECK (base_price_piasters >= 0),
  requires_clinical_authorization boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 100,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER nursing_services_touch BEFORE UPDATE ON app.nursing_services FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE app.nursing_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY nursing_services_select ON app.nursing_services FOR SELECT TO ghayarly_app
  USING ((active AND (NOT is_demo OR app.demo_visible())) OR app.has_permission('catalog.services.manage'));
CREATE POLICY nursing_services_write ON app.nursing_services FOR ALL TO ghayarly_app
  USING (app.has_permission('catalog.services.manage')) WITH CHECK (app.has_permission('catalog.services.manage'));
GRANT SELECT, INSERT, UPDATE ON app.nursing_services TO ghayarly_app;

CREATE TABLE app.provider_services (
  provider_user_id text NOT NULL REFERENCES app.provider_profiles (user_id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES app.nursing_services (id) ON DELETE CASCADE,
  price_piasters int CHECK (price_piasters IS NULL OR price_piasters BETWEEN 0 AND 10000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_user_id, service_id)
);

-- A provider may only offer services their provider type is eligible for.
CREATE FUNCTION app.provider_services_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.provider_profiles p JOIN app.nursing_services s ON s.id = NEW.service_id
    WHERE p.user_id = NEW.provider_user_id AND p.provider_type = ANY (s.eligible_provider_types)
  ) THEN
    RAISE EXCEPTION 'SERVICE_NOT_ELIGIBLE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER provider_services_guard BEFORE INSERT OR UPDATE ON app.provider_services FOR EACH ROW EXECUTE FUNCTION app.provider_services_guard();

ALTER TABLE app.provider_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_services_select ON app.provider_services FOR SELECT TO ghayarly_app
  USING (
    provider_user_id = app.current_user_id()
    OR app.has_permission('provider.verification.review')
    OR EXISTS (SELECT 1 FROM app.provider_profiles p WHERE p.user_id = provider_user_id AND p.verification_status = 'APPROVED')
  );
CREATE POLICY provider_services_write ON app.provider_services FOR ALL TO ghayarly_app
  USING (provider_user_id = app.current_user_id()) WITH CHECK (provider_user_id = app.current_user_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON app.provider_services TO ghayarly_app;

-- ------------------------------------------------------------------ TetraSol Care (single-brand store)
CREATE TABLE app.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- The store is TetraSol-only by construction: no other brand can be inserted.
  brand text NOT NULL DEFAULT 'TetraSol' CHECK (brand = 'TetraSol'),
  name_ar text NOT NULL,
  name_en text NOT NULL,
  summary_ar text NOT NULL,
  summary_en text NOT NULL,
  description_ar text NOT NULL,
  description_en text NOT NULL,
  usage_ar text NOT NULL,
  usage_en text NOT NULL,
  -- Content may be shown to customers only once APPROVED by the brand owner, with a reference.
  content_status app.content_approval_status NOT NULL DEFAULT 'PENDING_APPROVAL',
  approval_reference text,
  approved_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  approved_at timestamptz,
  regulatory_note text,
  sort_order int NOT NULL DEFAULT 100,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approved_requires_reference CHECK (content_status <> 'APPROVED' OR (approval_reference IS NOT NULL AND approved_at IS NOT NULL)),
  -- Synthetic items can never pass as approved real products and are always recognisable.
  CONSTRAINT demo_items_identifiable CHECK (NOT is_demo OR (slug LIKE 'demo-%' AND content_status <> 'APPROVED'))
);
CREATE TRIGGER products_touch BEFORE UPDATE ON app.products FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE app.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES app.products (id) ON DELETE CASCADE,
  sku text NOT NULL UNIQUE,
  label_ar text NOT NULL,
  label_en text NOT NULL,
  price_piasters int NOT NULL CHECK (price_piasters > 0),
  stock_status app.stock_status NOT NULL DEFAULT 'UNKNOWN',
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_variants_product_idx ON app.product_variants (product_id);
CREATE TRIGGER product_variants_touch BEFORE UPDATE ON app.product_variants FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE FUNCTION app.product_visible(p_product uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.products
    WHERE id = p_product
      AND ((content_status = 'APPROVED' AND NOT is_demo) OR (is_demo AND app.demo_visible()))
  )
$$;

ALTER TABLE app.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_select ON app.products FOR SELECT TO ghayarly_app
  USING (app.product_visible(id) OR app.has_permission('catalog.tetrasol.manage'));
CREATE POLICY products_write ON app.products FOR ALL TO ghayarly_app
  USING (app.has_permission('catalog.tetrasol.manage')) WITH CHECK (app.has_permission('catalog.tetrasol.manage') AND NOT is_demo);
GRANT SELECT, INSERT, UPDATE ON app.products TO ghayarly_app;

ALTER TABLE app.product_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_variants_select ON app.product_variants FOR SELECT TO ghayarly_app
  USING ((active AND app.product_visible(product_id)) OR app.has_permission('catalog.tetrasol.manage'));
CREATE POLICY product_variants_write ON app.product_variants FOR ALL TO ghayarly_app
  USING (app.has_permission('catalog.tetrasol.manage')) WITH CHECK (app.has_permission('catalog.tetrasol.manage'));
GRANT SELECT, INSERT, UPDATE ON app.product_variants TO ghayarly_app;

CREATE TABLE app.cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES app.product_variants (id) ON DELETE CASCADE,
  quantity int NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  -- Family purchasing: the authorized patient profile the item is for (optional).
  for_patient_id uuid REFERENCES app.patients (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cart_items_unique ON app.cart_items (user_id, variant_id, coalesce(for_patient_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE TRIGGER cart_items_touch BEFORE UPDATE ON app.cart_items FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE app.cart_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY cart_items_own ON app.cart_items FOR ALL TO ghayarly_app
  USING (user_id = app.current_user_id())
  WITH CHECK (
    user_id = app.current_user_id()
    AND (for_patient_id IS NULL OR app.can_view_patient(for_patient_id))
    AND EXISTS (SELECT 1 FROM app.product_variants v WHERE v.id = variant_id AND v.active AND app.product_visible(v.product_id))
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON app.cart_items TO ghayarly_app;

-- ------------------------------------------------------------------ provider earnings ledger
-- Append-only, signed amounts in piasters (net of platform fees for VISIT_EARNING lines).
-- Written by settlement jobs (Milestone 2) — the app role can only read its own lines.
CREATE TABLE app.provider_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id text NOT NULL REFERENCES app.provider_profiles (user_id) ON DELETE CASCADE,
  entry_type app.ledger_entry_type NOT NULL,
  status app.ledger_status NOT NULL,
  amount_piasters int NOT NULL,
  currency text NOT NULL DEFAULT 'EGP' CHECK (currency = 'EGP'),
  description text NOT NULL,
  booking_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_ledger_entries_idx ON app.provider_ledger_entries (provider_user_id, occurred_at DESC);
CREATE TRIGGER provider_ledger_immutable BEFORE UPDATE OR DELETE ON app.provider_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

ALTER TABLE app.provider_ledger_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_ledger_select ON app.provider_ledger_entries FOR SELECT TO ghayarly_app
  USING (provider_user_id = app.current_user_id() AND (NOT is_demo OR app.demo_visible()));
GRANT SELECT ON app.provider_ledger_entries TO ghayarly_app;

GRANT EXECUTE ON FUNCTION app.product_visible(uuid) TO ghayarly_app;
