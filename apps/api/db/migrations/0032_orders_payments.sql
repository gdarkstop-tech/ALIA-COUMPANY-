-- 0032 — TetraSol orders, stock reservations, delivery fees, Paymob payments and refunds
-- (Phase 8 M4/M5, ADR 0022).
--
-- Invariants enforced here, not in the API:
--   * prices, discounts and delivery fees are computed from the database at order time — the client
--     never sends a price; an optional expected total only guards against silent changes;
--   * stock is reserved under row locks when the order is placed (no overselling under concurrency)
--     and consumed only when the payment is verified; unpaid orders expire and release it;
--   * an order is PAID only through app.payment_apply, which only the payment worker / webhook
--     (system context) can call after verifying the provider's signature;
--   * one order per idempotency key per customer (double taps and retries cannot duplicate orders);
--   * physical TetraSol products only — digital subscriptions stay on Apple / Google billing.

-- ------------------------------------------------------------------ stock reservations
ALTER TABLE app.product_variants ADD COLUMN reserved_quantity int NOT NULL DEFAULT 0;
ALTER TABLE app.product_variants ADD CONSTRAINT variant_reserved_within_stock
  CHECK (reserved_quantity >= 0 AND (stock_quantity IS NULL OR reserved_quantity <= stock_quantity));

-- Internal stock change (orders / refunds). Not executable by the application role.
CREATE FUNCTION app.stock_apply(p_variant uuid, p_delta int, p_reason app.stock_reason, p_note text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE v_qty int; v_threshold int;
BEGIN
  SELECT coalesce(stock_quantity, 0), low_stock_threshold INTO v_qty, v_threshold FROM app.product_variants WHERE id = p_variant FOR NO KEY UPDATE;
  v_qty := v_qty + p_delta;
  IF v_qty < 0 THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING ERRCODE = 'P0001'; END IF;
  UPDATE app.product_variants SET stock_quantity = v_qty, stock_status = app.stock_status_for(v_qty, v_threshold) WHERE id = p_variant;
  INSERT INTO app.stock_movements (variant_id, delta, quantity_after, reason, note, actor_user_id)
  VALUES (p_variant, p_delta, v_qty, p_reason, p_note, app.current_user_id());
  RETURN v_qty;
END $$;
REVOKE ALL ON FUNCTION app.stock_apply(uuid, int, app.stock_reason, text) FROM PUBLIC;

-- ------------------------------------------------------------------ delivery zones
CREATE TABLE app.delivery_zones (
  governorate app.governorate PRIMARY KEY,
  active boolean NOT NULL DEFAULT false,
  fee_piasters int CHECK (fee_piasters IS NULL OR fee_piasters BETWEEN 0 AND 1000000),
  free_over_piasters int CHECK (free_over_piasters IS NULL OR free_over_piasters > 0),
  eta_min_days int CHECK (eta_min_days IS NULL OR eta_min_days BETWEEN 0 AND 30),
  eta_max_days int CHECK (eta_max_days IS NULL OR eta_max_days BETWEEN 0 AND 60),
  updated_by_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zone_active_needs_fee CHECK (NOT active OR fee_piasters IS NOT NULL),
  CONSTRAINT zone_eta_order CHECK (eta_min_days IS NULL OR eta_max_days IS NULL OR eta_max_days >= eta_min_days)
);
INSERT INTO app.delivery_zones (governorate) SELECT unnest(enum_range(NULL::app.governorate));
ALTER TABLE app.delivery_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY delivery_zones_select ON app.delivery_zones FOR SELECT TO ghayarly_app USING (true);
CREATE POLICY delivery_zones_update ON app.delivery_zones FOR UPDATE TO ghayarly_app
  USING (app.has_permission('orders.manage')) WITH CHECK (app.has_permission('orders.manage'));
GRANT SELECT, UPDATE ON app.delivery_zones TO ghayarly_app;

-- ------------------------------------------------------------------ orders
-- Fulfilment state and payment state are separate. PENDING_PAYMENT → CONFIRMED (payment verified)
-- → PROCESSING → SHIPPED → DELIVERED; or CANCELLED / EXPIRED (unpaid, stock released).
CREATE TYPE app.order_status AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'EXPIRED');
-- UNPAID → PENDING (checkout opened) → AUTHORIZED / PAID → SETTLED (provider settled the funds);
-- FAILED (attempt declined; the customer may retry until the order expires); PARTIALLY_REFUNDED,
-- REFUNDED; VOIDED.
CREATE TYPE app.payment_status AS ENUM ('UNPAID', 'PENDING', 'AUTHORIZED', 'PAID', 'SETTLED', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED');

CREATE TABLE app.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE CHECK (reference ~ '^OR-[0-9A-F]{8}$'),
  user_id text NOT NULL REFERENCES auth."user" ("id"),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 80),
  status app.order_status NOT NULL DEFAULT 'PENDING_PAYMENT',
  payment_status app.payment_status NOT NULL DEFAULT 'UNPAID',
  subtotal_piasters int NOT NULL CHECK (subtotal_piasters > 0),
  discount_piasters int NOT NULL DEFAULT 0 CHECK (discount_piasters >= 0),
  delivery_fee_piasters int NOT NULL CHECK (delivery_fee_piasters >= 0),
  total_piasters int NOT NULL CHECK (total_piasters > 0),
  refunded_piasters int NOT NULL DEFAULT 0 CHECK (refunded_piasters >= 0),
  currency text NOT NULL DEFAULT 'EGP' CHECK (currency = 'EGP'),
  discount_id uuid REFERENCES app.discounts (id) ON DELETE SET NULL,
  discount_code text,
  discount_name_ar text,
  discount_name_en text,
  recipient_name text NOT NULL CHECK (length(btrim(recipient_name)) BETWEEN 2 AND 80),
  phone text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  governorate app.governorate NOT NULL,
  city text NOT NULL CHECK (length(btrim(city)) BETWEEN 1 AND 80),
  district text CHECK (district IS NULL OR length(district) <= 80),
  address text NOT NULL CHECK (length(btrim(address)) BETWEEN 5 AND 300),
  delivery_notes text CHECK (delivery_notes IS NULL OR length(delivery_notes) <= 300),
  payment_expires_at timestamptz NOT NULL,
  tracking_reference text CHECK (tracking_reference IS NULL OR length(tracking_reference) <= 80),
  cancel_reason text CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 500),
  cancelled_by text CHECK (cancelled_by IS NULL OR cancelled_by IN ('CUSTOMER', 'STAFF', 'SYSTEM')),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  paid_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  UNIQUE (user_id, idempotency_key),
  CONSTRAINT order_totals CHECK (total_piasters = subtotal_piasters - discount_piasters + delivery_fee_piasters),
  CONSTRAINT order_refund_bound CHECK (refunded_piasters <= total_piasters)
);
CREATE INDEX orders_user_idx ON app.orders (user_id, created_at DESC);
CREATE INDEX orders_status_idx ON app.orders (status, created_at DESC);
CREATE INDEX orders_payment_status_idx ON app.orders (payment_status, created_at DESC);
CREATE TRIGGER orders_touch BEFORE UPDATE ON app.orders FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
ALTER TABLE app.orders ENABLE ROW LEVEL SECURITY;
-- The customer and commerce staff only. No clinical data lives on an order.
CREATE POLICY orders_select ON app.orders FOR SELECT TO ghayarly_app
  USING (user_id = app.current_user_id() OR app.has_permission('orders.manage') OR app.has_permission('payments.read'));
GRANT SELECT ON app.orders TO ghayarly_app;

CREATE TABLE app.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders (id) ON DELETE CASCADE,
  variant_id uuid REFERENCES app.product_variants (id) ON DELETE SET NULL,
  bundle_id uuid REFERENCES app.product_bundles (id) ON DELETE SET NULL,
  sku text,
  name_ar text NOT NULL,
  name_en text NOT NULL,
  label_ar text NOT NULL,
  label_en text NOT NULL,
  unit_price_piasters int NOT NULL CHECK (unit_price_piasters > 0),
  quantity int NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  line_total_piasters int NOT NULL CHECK (line_total_piasters = unit_price_piasters * quantity)
);
CREATE INDEX order_items_order_idx ON app.order_items (order_id);
ALTER TABLE app.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_items_select ON app.order_items FOR SELECT TO ghayarly_app USING (EXISTS (SELECT 1 FROM app.orders o WHERE o.id = order_id));
GRANT SELECT ON app.order_items TO ghayarly_app;

-- Physical units held for an order (bundles expanded to their variants).
CREATE TABLE app.order_reservations (
  order_id uuid NOT NULL REFERENCES app.orders (id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES app.product_variants (id),
  quantity int NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CONSUMED', 'RELEASED', 'RESTOCKED')),
  PRIMARY KEY (order_id, variant_id)
);
ALTER TABLE app.order_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_reservations_select ON app.order_reservations FOR SELECT TO ghayarly_app USING (app.has_permission('orders.manage'));
GRANT SELECT ON app.order_reservations TO ghayarly_app;

CREATE TABLE app.order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders (id) ON DELETE CASCADE,
  actor_user_id text REFERENCES auth."user" ("id") ON DELETE SET NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('CUSTOMER', 'STAFF', 'SYSTEM', 'PAYMENT_PROVIDER')),
  event text NOT NULL CHECK (length(event) BETWEEN 3 AND 40),
  status app.order_status NOT NULL,
  payment_status app.payment_status NOT NULL,
  note text CHECK (note IS NULL OR length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX order_events_idx ON app.order_events (order_id, created_at);
ALTER TABLE app.order_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_events_select ON app.order_events FOR SELECT TO ghayarly_app USING (EXISTS (SELECT 1 FROM app.orders o WHERE o.id = order_id));
GRANT SELECT ON app.order_events TO ghayarly_app;

-- ------------------------------------------------------------------ payments
CREATE TABLE app.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders (id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider = 'PAYMOB'),
  -- TEST until authorized production credentials exist (ADR 0022).
  mode text NOT NULL CHECK (mode IN ('TEST', 'LIVE')),
  status app.payment_status NOT NULL DEFAULT 'PENDING',
  amount_piasters int NOT NULL CHECK (amount_piasters > 0),
  currency text NOT NULL DEFAULT 'EGP' CHECK (currency = 'EGP'),
  intention_id text CHECK (intention_id IS NULL OR length(intention_id) <= 120),
  provider_order_id text CHECK (provider_order_id IS NULL OR length(provider_order_id) <= 40),
  transaction_id text CHECK (transaction_id IS NULL OR length(transaction_id) <= 40),
  refunded_piasters int NOT NULL DEFAULT 0 CHECK (refunded_piasters >= 0 AND refunded_piasters <= amount_piasters),
  failure_code text CHECK (failure_code IS NULL OR length(failure_code) <= 120),
  settled_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX payments_provider_order_idx ON app.payments (provider, provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE INDEX payments_order_idx ON app.payments (order_id, created_at DESC);
CREATE INDEX payments_status_idx ON app.payments (status, updated_at);
CREATE TRIGGER payments_touch BEFORE UPDATE ON app.payments FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
ALTER TABLE app.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY payments_select ON app.payments FOR SELECT TO ghayarly_app
  USING (app.has_permission('payments.read') OR EXISTS (SELECT 1 FROM app.orders o WHERE o.id = order_id AND o.user_id = app.current_user_id()));
GRANT SELECT ON app.payments TO ghayarly_app;

-- Every provider callback that passed signature verification, once (replay protection).
CREATE TABLE app.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_key text NOT NULL CHECK (length(event_key) <= 200),
  payment_id uuid REFERENCES app.payments (id) ON DELETE SET NULL,
  transaction_id text,
  outcome text NOT NULL CHECK (outcome IN ('APPLIED', 'NO_CHANGE', 'UNKNOWN_ORDER', 'MISMATCH', 'VERIFICATION_FAILED')),
  detail text CHECK (detail IS NULL OR length(detail) <= 300),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (provider, event_key)
);
ALTER TABLE app.payment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_events_select ON app.payment_events FOR SELECT TO ghayarly_app USING (app.has_permission('payments.read'));
GRANT SELECT ON app.payment_events TO ghayarly_app;

CREATE TABLE app.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders (id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL REFERENCES app.payments (id) ON DELETE RESTRICT,
  amount_piasters int NOT NULL CHECK (amount_piasters > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 500),
  restock boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED')),
  provider_reference text CHECK (provider_reference IS NULL OR length(provider_reference) <= 60),
  failure_code text CHECK (failure_code IS NULL OR length(failure_code) <= 120),
  requested_by_user_id text NOT NULL REFERENCES auth."user" ("id"),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX refunds_order_idx ON app.refunds (order_id);
CREATE TRIGGER refunds_touch BEFORE UPDATE ON app.refunds FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
ALTER TABLE app.refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY refunds_select ON app.refunds FOR SELECT TO ghayarly_app
  USING (app.has_permission('payments.read') OR EXISTS (SELECT 1 FROM app.orders o WHERE o.id = order_id AND o.user_id = app.current_user_id()));
GRANT SELECT ON app.refunds TO ghayarly_app;

-- ------------------------------------------------------------------ helpers
CREATE FUNCTION app.order_log(p_order uuid, p_role text, p_event text, p_note text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = app, pg_temp AS $$
  INSERT INTO app.order_events (order_id, actor_user_id, actor_role, event, status, payment_status, note)
  SELECT id, app.current_user_id(), p_role, p_event, status, payment_status, left(p_note, 500) FROM app.orders WHERE id = p_order
$$;
REVOKE ALL ON FUNCTION app.order_log(uuid, text, text, text) FROM PUBLIC;

-- Releases (unpaid) or restocks (paid, never shipped) the units held by an order.
CREATE FUNCTION app.order_release_stock(p_order uuid, p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM app.order_reservations WHERE order_id = p_order ORDER BY variant_id FOR UPDATE LOOP
    IF r.status = 'ACTIVE' THEN
      UPDATE app.product_variants SET reserved_quantity = reserved_quantity - r.quantity WHERE id = r.variant_id;
      UPDATE app.order_reservations SET status = 'RELEASED' WHERE order_id = p_order AND variant_id = r.variant_id;
    ELSIF r.status = 'CONSUMED' THEN
      PERFORM app.stock_apply(r.variant_id, r.quantity, 'RETURN', p_note);
      UPDATE app.order_reservations SET status = 'RESTOCKED' WHERE order_id = p_order AND variant_id = r.variant_id;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION app.order_release_stock(uuid, text) FROM PUBLIC;

-- ------------------------------------------------------------------ placing an order
-- The cart is priced here from the catalogue; the best applicable discount is chosen here; the
-- delivery fee comes from the configured zone. Stock is reserved under row locks (variants locked in
-- id order, so concurrent orders cannot deadlock or oversell).
CREATE FUNCTION app.order_place(p_idempotency_key text, p_discount_code text, p_recipient text, p_phone text, p_governorate app.governorate,
  p_city text, p_district text, p_address text, p_notes text, p_expected_total int)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_actor text := app.current_user_id();
  v_existing uuid;
  v_id uuid;
  v_subtotal int := 0;
  v_discount int := 0;
  v_best_id uuid;
  v_best_code text;
  v_best_name_ar text;
  v_best_name_en text;
  v_d record;
  v_eligible int;
  v_amount int;
  v_zone app.delivery_zones%ROWTYPE;
  v_fee int;
  v_total int;
  v_lines int;
  v_demo boolean;
  r record;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501'; END IF;
  IF NOT app.account_active(v_actor) THEN RAISE EXCEPTION 'ACCOUNT_RESTRICTED' USING ERRCODE = '42501'; END IF;
  IF NOT app.flag_on('commerce.checkout') THEN RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = 'P0001'; END IF;
  -- Idempotency: the same key returns the same order, whatever else was sent.
  PERFORM pg_advisory_xact_lock(hashtextextended('order:' || v_actor || ':' || p_idempotency_key, 0));
  SELECT id INTO v_existing FROM app.orders WHERE user_id = v_actor AND idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  -- Priced lines from the customer's cart, only items currently on sale.
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.order_lines (variant_id uuid, bundle_id uuid, sku text, name_ar text, name_en text, label_ar text, label_en text,
    unit_price int, quantity int, product_id uuid, category_id uuid, is_demo boolean) ON COMMIT DROP;
  DELETE FROM pg_temp.order_lines;
  INSERT INTO pg_temp.order_lines
    SELECT v.id, NULL, v.sku, p.name_ar, p.name_en, v.label_ar, v.label_en, v.price_piasters, c.quantity, p.id, p.category_id, p.is_demo
    FROM app.cart_items c JOIN app.product_variants v ON v.id = c.variant_id JOIN app.products p ON p.id = v.product_id
    WHERE c.user_id = v_actor AND v.active AND app.product_visible(p.id)
    UNION ALL
    SELECT NULL, b.id, NULL, b.name_ar, b.name_en, 'باقة', 'Bundle', b.price_piasters, c.quantity, NULL, NULL, false
    FROM app.cart_items c JOIN app.product_bundles b ON b.id = c.bundle_id
    WHERE c.user_id = v_actor AND app.bundle_visible(b.id);
  SELECT count(*), coalesce(sum(unit_price * quantity), 0), coalesce(bool_or(is_demo), false) INTO v_lines, v_subtotal, v_demo FROM pg_temp.order_lines;
  IF v_lines = 0 THEN RAISE EXCEPTION 'CART_EMPTY' USING ERRCODE = 'P0001'; END IF;
  IF (SELECT count(*) FROM app.cart_items WHERE user_id = v_actor) <> v_lines THEN RAISE EXCEPTION 'CART_HAS_UNAVAILABLE_ITEMS' USING ERRCODE = 'P0001'; END IF;

  -- Best applicable discount (same rules as the checkout preview).
  FOR v_d IN SELECT * FROM app.applicable_discounts(p_discount_code) LOOP
    IF v_subtotal < v_d.min_subtotal_piasters THEN CONTINUE; END IF;
    SELECT coalesce(sum(unit_price * quantity), 0) INTO v_eligible FROM pg_temp.order_lines l
    WHERE CASE v_d.scope WHEN 'ALL' THEN true WHEN 'CATEGORY' THEN l.category_id = v_d.target_id WHEN 'PRODUCT' THEN l.product_id = v_d.target_id
                         WHEN 'VARIANT' THEN l.variant_id = v_d.target_id WHEN 'BUNDLE' THEN l.bundle_id = v_d.target_id ELSE false END;
    IF v_eligible <= 0 THEN CONTINUE; END IF;
    v_amount := CASE WHEN v_d.kind = 'PERCENT' THEN floor(v_eligible::numeric * v_d.value / 100)::int ELSE least(v_d.value, v_eligible) END;
    IF v_amount > v_discount THEN
      v_discount := v_amount; v_best_id := v_d.id; v_best_code := v_d.code; v_best_name_ar := v_d.name_ar; v_best_name_en := v_d.name_en;
    END IF;
  END LOOP;
  IF p_discount_code IS NOT NULL AND btrim(p_discount_code) <> '' AND v_best_code IS DISTINCT FROM upper(btrim(p_discount_code)) THEN
    RAISE EXCEPTION 'DISCOUNT_NOT_APPLICABLE' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_zone FROM app.delivery_zones WHERE governorate = p_governorate;
  IF NOT coalesce(v_zone.active, false) THEN RAISE EXCEPTION 'DELIVERY_NOT_AVAILABLE' USING ERRCODE = 'P0001'; END IF;
  v_fee := CASE WHEN v_zone.free_over_piasters IS NOT NULL AND v_subtotal - v_discount >= v_zone.free_over_piasters THEN 0 ELSE v_zone.fee_piasters END;
  v_total := v_subtotal - v_discount + v_fee;
  IF v_total <= 0 THEN RAISE EXCEPTION 'INVALID_TOTAL' USING ERRCODE = 'P0001'; END IF;
  IF p_expected_total IS NOT NULL AND p_expected_total <> v_total THEN
    RAISE EXCEPTION 'PRICE_CHANGED' USING ERRCODE = 'P0001', DETAIL = v_total::text;
  END IF;

  -- Reserve physical units first (bundles expanded), locking variants in a fixed order and before any
  -- row referencing them is written: concurrent checkouts queue on the variant instead of deadlocking.
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.order_holds (variant_id uuid, qty int) ON COMMIT DROP;
  DELETE FROM pg_temp.order_holds;
  FOR r IN
    SELECT u.variant_id, sum(u.qty)::int AS qty FROM (
      SELECT variant_id, quantity AS qty FROM pg_temp.order_lines WHERE variant_id IS NOT NULL
      UNION ALL
      SELECT bi.variant_id, bi.quantity * l.quantity FROM pg_temp.order_lines l JOIN app.product_bundle_items bi ON bi.bundle_id = l.bundle_id
    ) u GROUP BY u.variant_id ORDER BY u.variant_id
  LOOP
    UPDATE app.product_variants SET reserved_quantity = reserved_quantity + r.qty
    WHERE id = r.variant_id AND stock_quantity IS NOT NULL AND stock_quantity - reserved_quantity >= r.qty;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'OUT_OF_STOCK' USING ERRCODE = 'P0001', DETAIL = coalesce((SELECT sku FROM app.product_variants WHERE id = r.variant_id), '');
    END IF;
    INSERT INTO pg_temp.order_holds VALUES (r.variant_id, r.qty);
  END LOOP;

  INSERT INTO app.orders (reference, user_id, idempotency_key, subtotal_piasters, discount_piasters, delivery_fee_piasters, total_piasters,
                          discount_id, discount_code, discount_name_ar, discount_name_en, recipient_name, phone, governorate, city, district, address,
                          delivery_notes, payment_expires_at, is_demo)
  VALUES ('OR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)), v_actor, p_idempotency_key, v_subtotal, v_discount, v_fee, v_total,
          v_best_id, v_best_code, v_best_name_ar, v_best_name_en, btrim(p_recipient), p_phone, p_governorate, btrim(p_city), nullif(btrim(p_district), ''),
          btrim(p_address), nullif(btrim(p_notes), ''), clock_timestamp() + interval '30 minutes', v_demo)
  RETURNING id INTO v_id;
  INSERT INTO app.order_items (order_id, variant_id, bundle_id, sku, name_ar, name_en, label_ar, label_en, unit_price_piasters, quantity, line_total_piasters)
    SELECT v_id, variant_id, bundle_id, sku, name_ar, name_en, label_ar, label_en, unit_price, quantity, unit_price * quantity FROM pg_temp.order_lines;

  INSERT INTO app.order_reservations (order_id, variant_id, quantity) SELECT v_id, variant_id, qty FROM pg_temp.order_holds;

  DELETE FROM app.cart_items WHERE user_id = v_actor;
  PERFORM app.order_log(v_id, 'CUSTOMER', 'PLACED', NULL);
  RETURN v_id;
END $$;

-- ------------------------------------------------------------------ payment state (system only)
-- Records the payment attempt created with the provider for an order awaiting payment.
CREATE FUNCTION app.payment_open(p_order uuid, p_mode text, p_intention text, p_provider_order text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE o app.orders%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO o FROM app.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR (app.current_user_id() IS NOT NULL AND o.user_id <> app.current_user_id()) THEN RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF o.status <> 'PENDING_PAYMENT' OR o.payment_expires_at <= now() THEN RAISE EXCEPTION 'ORDER_NOT_PAYABLE' USING ERRCODE = 'P0001'; END IF;
  IF o.payment_status IN ('PAID', 'AUTHORIZED', 'SETTLED') THEN RAISE EXCEPTION 'ALREADY_PAID' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO app.payments (order_id, provider, mode, amount_piasters, intention_id, provider_order_id)
  VALUES (p_order, 'PAYMOB', p_mode, o.total_piasters, p_intention, p_provider_order) RETURNING id INTO v_id;
  UPDATE app.orders SET payment_status = 'PENDING' WHERE id = p_order;
  PERFORM app.order_log(p_order, 'CUSTOMER', 'PAYMENT_STARTED', NULL);
  RETURN v_id;
END $$;

-- Applies a VERIFIED provider transaction to a payment and its order. Idempotent; never moves a
-- payment backwards (a paid order is never set to failed by a late or replayed callback).
CREATE FUNCTION app.payment_apply(p_payment uuid, p_transaction text, p_success boolean, p_pending boolean, p_is_auth boolean,
  p_is_voided boolean, p_refunded_piasters int, p_is_settled boolean, p_failure text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  p app.payments%ROWTYPE;
  o app.orders%ROWTYPE;
  v_new app.payment_status;
  r record;
BEGIN
  IF app.current_user_id() IS NOT NULL THEN RAISE EXCEPTION 'SYSTEM_ONLY' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM app.payments WHERE id = p_payment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO o FROM app.orders WHERE id = p.order_id FOR UPDATE;

  v_new := CASE
    WHEN p_is_voided THEN 'VOIDED'
    WHEN coalesce(p_refunded_piasters, 0) >= p.amount_piasters THEN 'REFUNDED'
    WHEN coalesce(p_refunded_piasters, 0) > 0 THEN 'PARTIALLY_REFUNDED'
    WHEN p_success AND NOT p_pending AND p_is_auth THEN 'AUTHORIZED'
    WHEN p_success AND NOT p_pending AND p_is_settled THEN 'SETTLED'
    WHEN p_success AND NOT p_pending THEN 'PAID'
    WHEN p_pending THEN 'PENDING'
    ELSE 'FAILED' END;
  -- Never backwards: a captured payment does not become pending / failed / authorized again.
  IF (p.status IN ('PAID', 'SETTLED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED') AND v_new IN ('PENDING', 'FAILED', 'AUTHORIZED'))
     OR (p.status = 'SETTLED' AND v_new = 'PAID')
     OR (p.status IN ('REFUNDED', 'VOIDED') AND v_new <> p.status)
     OR (v_new = p.status AND p.transaction_id IS NOT DISTINCT FROM p_transaction AND p.refunded_piasters = coalesce(p_refunded_piasters, 0)) THEN
    RETURN jsonb_build_object('outcome', 'NO_CHANGE', 'before', o.payment_status, 'after', o.payment_status);
  END IF;

  UPDATE app.payments SET status = v_new, transaction_id = coalesce(p_transaction, transaction_id),
    refunded_piasters = greatest(refunded_piasters, coalesce(p_refunded_piasters, 0)),
    failure_code = CASE WHEN v_new = 'FAILED' THEN left(p_failure, 120) ELSE failure_code END,
    settled_at = CASE WHEN v_new = 'SETTLED' THEN coalesce(settled_at, clock_timestamp()) ELSE settled_at END,
    last_verified_at = clock_timestamp()
  WHERE id = p_payment;

  IF v_new IN ('PAID', 'SETTLED') AND o.payment_status NOT IN ('PAID', 'SETTLED', 'PARTIALLY_REFUNDED', 'REFUNDED') THEN
    IF o.status = 'PENDING_PAYMENT' THEN
      -- Consume the reserved units: they leave stock now.
      FOR r IN SELECT * FROM app.order_reservations WHERE order_id = o.id AND status = 'ACTIVE' ORDER BY variant_id LOOP
        UPDATE app.product_variants SET reserved_quantity = reserved_quantity - r.quantity WHERE id = r.variant_id;
        PERFORM app.stock_apply(r.variant_id, -r.quantity, 'SALE', 'Order ' || o.reference);
        UPDATE app.order_reservations SET status = 'CONSUMED' WHERE order_id = o.id AND variant_id = r.variant_id;
      END LOOP;
      UPDATE app.orders SET status = 'CONFIRMED', payment_status = v_new, paid_at = clock_timestamp() WHERE id = o.id;
      PERFORM app.order_log(o.id, 'PAYMENT_PROVIDER', 'PAID', 'Transaction ' || coalesce(p_transaction, ''));
    ELSE
      -- Money arrived for an order that is no longer awaiting payment (expired or cancelled):
      -- record it truthfully and hand it to staff — refund or fulfil — never silently.
      UPDATE app.orders SET payment_status = v_new, paid_at = coalesce(paid_at, clock_timestamp()) WHERE id = o.id;
      PERFORM app.order_log(o.id, 'PAYMENT_PROVIDER', 'PAID_AFTER_CLOSE', 'Transaction ' || coalesce(p_transaction, ''));
      PERFORM app.open_incident('PAYMENT_MISMATCH', 'HIGH', 'COMMERCE', 'Payment received for closed order ' || o.reference,
        'Order status ' || o.status || '; refund or fulfil', 'order', o.id);
    END IF;
  ELSIF v_new = 'AUTHORIZED' THEN
    UPDATE app.orders SET payment_status = 'AUTHORIZED' WHERE id = o.id AND payment_status IN ('UNPAID', 'PENDING', 'FAILED');
    PERFORM app.order_log(o.id, 'PAYMENT_PROVIDER', 'AUTHORIZED', NULL);
  ELSIF v_new = 'SETTLED' THEN
    UPDATE app.orders SET payment_status = 'SETTLED' WHERE id = o.id AND payment_status = 'PAID';
  ELSIF v_new IN ('REFUNDED', 'PARTIALLY_REFUNDED', 'VOIDED') THEN
    UPDATE app.orders SET payment_status = v_new, refunded_piasters = greatest(refunded_piasters, coalesce(p_refunded_piasters, 0)) WHERE id = o.id;
    PERFORM app.order_log(o.id, 'PAYMENT_PROVIDER', v_new::text, NULL);
  ELSIF v_new = 'FAILED' AND o.payment_status IN ('UNPAID', 'PENDING') THEN
    UPDATE app.orders SET payment_status = 'FAILED' WHERE id = o.id;
    PERFORM app.order_log(o.id, 'PAYMENT_PROVIDER', 'PAYMENT_FAILED', left(p_failure, 200));
  END IF;
  RETURN jsonb_build_object('outcome', 'APPLIED', 'before', o.payment_status, 'after', (SELECT payment_status FROM app.orders WHERE id = o.id));
END $$;

-- Unpaid orders past their payment window expire and release stock (worker, system context).
CREATE FUNCTION app.orders_expire() RETURNS SETOF uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE r record;
BEGIN
  IF app.current_user_id() IS NOT NULL THEN RAISE EXCEPTION 'SYSTEM_ONLY' USING ERRCODE = '42501'; END IF;
  FOR r IN SELECT id FROM app.orders WHERE status = 'PENDING_PAYMENT' AND payment_expires_at <= now()
           AND payment_status NOT IN ('AUTHORIZED', 'PAID', 'SETTLED') FOR UPDATE SKIP LOCKED LOOP
    PERFORM app.order_release_stock(r.id, 'Order expired');
    UPDATE app.orders SET status = 'EXPIRED' WHERE id = r.id;
    PERFORM app.order_log(r.id, 'SYSTEM', 'EXPIRED', NULL);
    RETURN NEXT r.id;
  END LOOP;
END $$;

-- ------------------------------------------------------------------ customer and staff actions
-- Customers cancel unpaid orders; commerce staff cancel unpaid or paid-but-unshipped orders (a paid
-- order then needs a refund, which is a separate, audited step).
CREATE FUNCTION app.order_cancel(p_order uuid, p_reason text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE o app.orders%ROWTYPE; v_role text;
BEGIN
  SELECT * INTO o FROM app.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_role := CASE WHEN app.has_permission('orders.manage') THEN 'STAFF' WHEN o.user_id = app.current_user_id() THEN 'CUSTOMER' END;
  IF v_role IS NULL THEN RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_role = 'CUSTOMER' AND (o.status <> 'PENDING_PAYMENT' OR o.payment_status IN ('AUTHORIZED', 'PAID', 'SETTLED')) THEN
    RAISE EXCEPTION 'CANNOT_CANCEL' USING ERRCODE = 'P0001';
  END IF;
  IF v_role = 'STAFF' AND o.status NOT IN ('PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING') THEN RAISE EXCEPTION 'CANNOT_CANCEL' USING ERRCODE = 'P0001'; END IF;
  IF v_role = 'STAFF' AND coalesce(length(btrim(p_reason)), 0) < 5 THEN RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  PERFORM app.order_release_stock(p_order, 'Order cancelled before shipment');
  UPDATE app.orders SET status = 'CANCELLED', cancelled_at = clock_timestamp(), cancelled_by = v_role, cancel_reason = left(nullif(btrim(p_reason), ''), 500) WHERE id = p_order;
  PERFORM app.order_log(p_order, v_role, 'CANCELLED', p_reason);
  IF v_role = 'STAFF' THEN
    PERFORM app.write_audit('orders.cancel', 'order', p_order::text, NULL, jsonb_build_object('reference', o.reference, 'reason', p_reason, 'paymentStatus', o.payment_status));
  END IF;
  RETURN o.payment_status::text;
END $$;

-- Fulfilment by commerce staff. Only paid orders move on.
CREATE FUNCTION app.order_fulfil(p_order uuid, p_action text, p_tracking text) RETURNS app.order_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE o app.orders%ROWTYPE; v_to app.order_status;
BEGIN
  IF NOT app.has_permission('orders.manage') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO o FROM app.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF o.payment_status NOT IN ('PAID', 'SETTLED') THEN RAISE EXCEPTION 'NOT_PAID' USING ERRCODE = 'P0001'; END IF;
  v_to := CASE
    WHEN p_action = 'PROCESS' AND o.status = 'CONFIRMED' THEN 'PROCESSING'
    WHEN p_action = 'SHIP' AND o.status IN ('CONFIRMED', 'PROCESSING') THEN 'SHIPPED'
    WHEN p_action = 'DELIVER' AND o.status = 'SHIPPED' THEN 'DELIVERED'
  END;
  IF v_to IS NULL THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001'; END IF;
  UPDATE app.orders SET status = v_to,
    tracking_reference = CASE WHEN v_to = 'SHIPPED' THEN coalesce(nullif(btrim(p_tracking), ''), tracking_reference) ELSE tracking_reference END,
    shipped_at = CASE WHEN v_to = 'SHIPPED' THEN clock_timestamp() ELSE shipped_at END,
    delivered_at = CASE WHEN v_to = 'DELIVERED' THEN clock_timestamp() ELSE delivered_at END
  WHERE id = p_order;
  PERFORM app.order_log(p_order, 'STAFF', v_to::text, p_tracking);
  PERFORM app.write_audit('orders.fulfil', 'order', p_order::text, NULL, jsonb_build_object('reference', o.reference, 'to', v_to));
  RETURN v_to;
END $$;

-- Refunds: payments.refund staff only; amount bounded by what was paid and not yet refunded.
CREATE FUNCTION app.refund_request(p_order uuid, p_amount int, p_reason text, p_restock boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE o app.orders%ROWTYPE; p app.payments%ROWTYPE; v_id uuid; v_pending int;
BEGIN
  IF NOT app.has_permission('payments.refund') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO o FROM app.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO p FROM app.payments WHERE order_id = p_order AND status IN ('PAID', 'SETTLED', 'PARTIALLY_REFUNDED') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR p.transaction_id IS NULL THEN RAISE EXCEPTION 'NOTHING_TO_REFUND' USING ERRCODE = 'P0001'; END IF;
  SELECT coalesce(sum(amount_piasters), 0) INTO v_pending FROM app.refunds WHERE payment_id = p.id AND status IN ('REQUESTED', 'PROCESSING');
  IF p_amount <= 0 OR p_amount > p.amount_piasters - p.refunded_piasters - v_pending THEN RAISE EXCEPTION 'REFUND_EXCEEDS_PAID' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO app.refunds (order_id, payment_id, amount_piasters, reason, restock, status, requested_by_user_id)
  VALUES (p_order, p.id, p_amount, btrim(p_reason), coalesce(p_restock, false), 'PROCESSING', app.current_user_id()) RETURNING id INTO v_id;
  PERFORM app.order_log(p_order, 'STAFF', 'REFUND_REQUESTED', p_reason);
  PERFORM app.write_audit('payments.refund.requested', 'order', p_order::text, NULL, jsonb_build_object('reference', o.reference, 'amount', p_amount, 'refundId', v_id));
  RETURN v_id;
END $$;

-- Outcome of the provider refund call (API, staff context).
CREATE FUNCTION app.refund_settle(p_refund uuid, p_success boolean, p_reference text, p_failure text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE f app.refunds%ROWTYPE; p app.payments%ROWTYPE; v_total int; v_status app.payment_status;
BEGIN
  IF NOT app.has_permission('payments.refund') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO f FROM app.refunds WHERE id = p_refund AND status = 'PROCESSING' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REFUND_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF NOT p_success THEN
    UPDATE app.refunds SET status = 'FAILED', failure_code = left(p_failure, 120) WHERE id = p_refund;
    PERFORM app.order_log(f.order_id, 'STAFF', 'REFUND_FAILED', p_failure);
    PERFORM app.open_incident('REFUND_FAILED', 'HIGH', 'COMMERCE', 'Refund failed for order ' || (SELECT reference FROM app.orders WHERE id = f.order_id),
      left(coalesce(p_failure, 'unknown'), 200), 'refund', p_refund);
    RETURN;
  END IF;
  UPDATE app.refunds SET status = 'SUCCEEDED', provider_reference = left(p_reference, 60) WHERE id = p_refund;
  SELECT * INTO p FROM app.payments WHERE id = f.payment_id FOR UPDATE;
  v_total := p.refunded_piasters + f.amount_piasters;
  v_status := CASE WHEN v_total >= p.amount_piasters THEN 'REFUNDED' ELSE 'PARTIALLY_REFUNDED' END;
  UPDATE app.payments SET refunded_piasters = v_total, status = v_status WHERE id = p.id;
  UPDATE app.orders SET refunded_piasters = v_total, payment_status = v_status WHERE id = f.order_id;
  IF f.restock THEN PERFORM app.order_release_stock(f.order_id, 'Refunded and returned to stock'); END IF;
  PERFORM app.order_log(f.order_id, 'STAFF', v_status::text, NULL);
  PERFORM app.write_audit('payments.refund.succeeded', 'order', f.order_id::text, NULL, jsonb_build_object('refundId', p_refund, 'amount', f.amount_piasters));
END $$;

REVOKE ALL ON FUNCTION app.order_place(text, text, text, text, app.governorate, text, text, text, text, int),
  app.payment_open(uuid, text, text, text), app.payment_apply(uuid, text, boolean, boolean, boolean, boolean, int, boolean, text), app.orders_expire(),
  app.order_cancel(uuid, text), app.order_fulfil(uuid, text, text), app.refund_request(uuid, int, text, boolean), app.refund_settle(uuid, boolean, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.order_place(text, text, text, text, app.governorate, text, text, text, text, int),
  app.payment_open(uuid, text, text, text), app.payment_apply(uuid, text, boolean, boolean, boolean, boolean, int, boolean, text), app.orders_expire(),
  app.order_cancel(uuid, text), app.order_fulfil(uuid, text, text), app.refund_request(uuid, int, text, boolean), app.refund_settle(uuid, boolean, text, text) TO ghayarly_app;

-- Payment events are written only by the webhook processor (system context).
CREATE FUNCTION app.payment_event_record(p_provider text, p_key text, p_payment uuid, p_transaction text, p_outcome text, p_detail text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.current_user_id() IS NOT NULL THEN RAISE EXCEPTION 'SYSTEM_ONLY' USING ERRCODE = '42501'; END IF;
  INSERT INTO app.payment_events (provider, event_key, payment_id, transaction_id, outcome, detail)
  VALUES (p_provider, p_key, p_payment, p_transaction, p_outcome, left(p_detail, 300)) ON CONFLICT (provider, event_key) DO NOTHING;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION app.payment_event_record(text, text, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.payment_event_record(text, text, uuid, text, text, text) TO ghayarly_app;

-- Order messages may be cancelled by parties to the order (extends the booking door of 0031).
CREATE OR REPLACE FUNCTION app.notifications_cancel_related(p_type text, p_id uuid, p_purposes text[]) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  a app.appointments%ROWTYPE;
  n int;
BEGIN
  IF app.current_user_id() IS NOT NULL AND NOT app.has_permission('ops.manage') THEN
    IF p_type = 'appointment' THEN
      SELECT * INTO a FROM app.appointments WHERE id = p_id;
      IF NOT FOUND OR app.appointment_actor_role(a) IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
    ELSIF p_type = 'order' THEN
      IF NOT (app.has_permission('orders.manage') OR EXISTS (SELECT 1 FROM app.orders WHERE id = p_id AND user_id = app.current_user_id())) THEN
        RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
      END IF;
    ELSE
      RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
    END IF;
  END IF;
  UPDATE app.notifications SET status = 'CANCELLED', updated_at = clock_timestamp()
  WHERE related_type = p_type AND related_id = p_id AND status = 'QUEUED' AND (p_purposes IS NULL OR purpose = ANY (p_purposes));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Contacts for order messages (customer only), resolved server-side.
CREATE FUNCTION app.order_message_context(p_order uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE o app.orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM app.orders WHERE id = p_order;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF app.current_user_id() IS NOT NULL AND o.user_id <> app.current_user_id() AND NOT app.has_permission('orders.manage') AND NOT app.has_permission('payments.refund') THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT jsonb_build_object('id', o.id, 'reference', o.reference, 'status', o.status, 'paymentStatus', o.payment_status, 'total', o.total_piasters,
      'refunded', o.refunded_piasters, 'userId', u.id,
      'email', CASE WHEN u.email LIKE '%@phone.ghayarly.invalid' OR u.email LIKE '%@deleted.invalid' THEN NULL ELSE u.email END,
      'phone', o.phone, 'locale', coalesce(up.locale::text, 'ar'))
    FROM auth."user" u LEFT JOIN app.user_profiles up ON up.user_id = u.id WHERE u.id = o.user_id);
END $$;
REVOKE ALL ON FUNCTION app.order_message_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.order_message_context(uuid) TO ghayarly_app;

-- Account deletion: unpaid orders are cancelled; delivery addresses of closed orders are removed
-- (orders themselves are kept for tax and accounting records).
CREATE FUNCTION app.orders_forget_deleted_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM app.orders WHERE user_id = NEW.user_id AND status = 'PENDING_PAYMENT' AND payment_status NOT IN ('AUTHORIZED', 'PAID', 'SETTLED') LOOP
    PERFORM app.order_release_stock(r.id, 'Account deleted');
    UPDATE app.orders SET status = 'CANCELLED', cancelled_at = clock_timestamp(), cancelled_by = 'SYSTEM', cancel_reason = 'Account deleted' WHERE id = r.id;
  END LOOP;
  UPDATE app.orders SET address = '[removed with the account]', district = NULL, delivery_notes = NULL, recipient_name = 'Deleted account', phone = '+20000000000'
  WHERE user_id = NEW.user_id AND status IN ('DELIVERED', 'CANCELLED', 'EXPIRED');
  RETURN NEW;
END $$;
CREATE TRIGGER account_deletions_orders AFTER INSERT ON app.account_deletions FOR EACH ROW EXECUTE FUNCTION app.orders_forget_deleted_account();

-- ------------------------------------------------------------------ payment worker lookups (system only)
CREATE FUNCTION app.payment_lookup(p_provider_order text) RETURNS TABLE (payment_id uuid, order_id uuid, order_reference text, amount_piasters int, mode text,
  status app.payment_status, provider_order_id text, transaction_id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.current_user_id() IS NOT NULL THEN RAISE EXCEPTION 'SYSTEM_ONLY' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT p.id, p.order_id, o.reference, p.amount_piasters, p.mode, p.status, p.provider_order_id, p.transaction_id
    FROM app.payments p JOIN app.orders o ON o.id = p.order_id WHERE p.provider = 'PAYMOB' AND p.provider_order_id = p_provider_order;
END $$;

-- Payments whose final state is not yet known or not yet settled (reconciliation).
CREATE FUNCTION app.payments_to_reconcile(p_limit int) RETURNS TABLE (payment_id uuid, order_id uuid, order_reference text, amount_piasters int, mode text,
  status app.payment_status, provider_order_id text, transaction_id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.current_user_id() IS NOT NULL AND NOT app.has_permission('payments.read') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT p.id, p.order_id, o.reference, p.amount_piasters, p.mode, p.status, p.provider_order_id, p.transaction_id
    FROM app.payments p JOIN app.orders o ON o.id = p.order_id
    WHERE p.provider_order_id IS NOT NULL AND (
      (p.status IN ('PENDING', 'AUTHORIZED', 'FAILED') AND p.created_at < now() - interval '10 minutes' AND p.created_at > now() - interval '3 days')
      OR (p.status IN ('PAID', 'PARTIALLY_REFUNDED') AND p.settled_at IS NULL AND p.created_at > now() - interval '30 days'))
    ORDER BY p.last_verified_at NULLS FIRST, p.created_at LIMIT least(greatest(p_limit, 1), 200);
END $$;
REVOKE ALL ON FUNCTION app.payment_lookup(text), app.payments_to_reconcile(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.payment_lookup(text), app.payments_to_reconcile(int) TO ghayarly_app;

-- A verified provider transaction that does not match what we charged (amount, currency, order,
-- test/live mode): escalated to commerce operations. Payment worker / webhook only.
CREATE FUNCTION app.payment_flag_mismatch(p_order uuid, p_detail text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.current_user_id() IS NOT NULL AND NOT app.has_permission('payments.refund') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  PERFORM app.open_incident('PAYMENT_MISMATCH', 'HIGH', 'COMMERCE',
    'Payment does not match order ' || coalesce((SELECT reference FROM app.orders WHERE id = p_order), '?'), left(p_detail, 300), 'order', p_order);
END $$;
REVOKE ALL ON FUNCTION app.payment_flag_mismatch(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.payment_flag_mismatch(uuid, text) TO ghayarly_app;

CREATE FUNCTION app.payment_event_set_outcome(p_provider text, p_key text, p_outcome text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.current_user_id() IS NOT NULL THEN RAISE EXCEPTION 'SYSTEM_ONLY' USING ERRCODE = '42501'; END IF;
  UPDATE app.payment_events SET outcome = p_outcome WHERE provider = p_provider AND event_key = p_key;
END $$;
REVOKE ALL ON FUNCTION app.payment_event_set_outcome(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.payment_event_set_outcome(text, text, text) TO ghayarly_app;
