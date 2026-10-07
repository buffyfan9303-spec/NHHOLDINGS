CREATE TABLE IF NOT EXISTS mkt_settings (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS mkt_media (id text PRIMARY KEY, mime text NOT NULL, size integer NOT NULL CHECK(size>0), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS mkt_products (
 id text PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL,
 category text NOT NULL CHECK(category IN ('clicker','figure','apparel','gear')),
 price integer NOT NULL CHECK(price > 0), data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS mkt_variants (
 id text PRIMARY KEY, product_id text NOT NULL REFERENCES mkt_products(id), label text NOT NULL,
 price_delta integer NOT NULL DEFAULT 0, options jsonb NOT NULL DEFAULT '{}',
 on_hand integer NOT NULL CHECK(on_hand >= 0), reserved integer NOT NULL DEFAULT 0 CHECK(reserved >= 0),
 allocated integer NOT NULL DEFAULT 0 CHECK(allocated >= 0), safety_stock integer NOT NULL DEFAULT 0 CHECK(safety_stock >= 0),
 CHECK(reserved + allocated <= on_hand)
);
CREATE TABLE IF NOT EXISTS mkt_coupons (
 code text PRIMARY KEY, percent integer NOT NULL CHECK(percent BETWEEN 1 AND 100),
 max_discount integer NOT NULL CHECK(max_discount >= 0), min_amount integer NOT NULL CHECK(min_amount >= 0),
 expires_at timestamptz, active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS mkt_orders (
 id text PRIMARY KEY, number text UNIQUE NOT NULL, request_id text UNIQUE NOT NULL, request_hash text NOT NULL, access_hash text NOT NULL,
 customer jsonb NOT NULL, method text NOT NULL CHECK(method IN ('CARD','NAVERPAY','KAKAOPAY','VIRTUAL_ACCOUNT')),
 subtotal integer NOT NULL CHECK(subtotal > 0), discount integer NOT NULL CHECK(discount >= 0), shipping integer NOT NULL CHECK(shipping >= 0),
 total integer NOT NULL CHECK(total > 0), refund_total integer NOT NULL DEFAULT 0 CHECK(refund_total >= 0 AND refund_total <= total),
 payment_status text NOT NULL CHECK(payment_status IN ('PENDING','WAITING_FOR_DEPOSIT','PAID','PARTIALLY_REFUNDED','REFUNDING','REFUNDED','FAILED','EXPIRED')),
 fulfillment_status text NOT NULL DEFAULT 'UNFULFILLED' CHECK(fulfillment_status IN ('UNFULFILLED','PREPARING','LABEL_REGISTERED','SHIPPED','PARTIALLY_SHIPPED','DELIVERED')),
 purchase_status text NOT NULL DEFAULT 'OPEN' CHECK(purchase_status IN ('OPEN','CONFIRMED')),
 is_demo boolean NOT NULL, coupon_code text, consent jsonb NOT NULL, due_at timestamptz,
 delivered_at timestamptz, confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(total = subtotal - discount + shipping)
);
CREATE TABLE IF NOT EXISTS mkt_order_items (
 id text PRIMARY KEY, order_id text NOT NULL REFERENCES mkt_orders(id), product_id text NOT NULL REFERENCES mkt_products(id),
 variant_id text NOT NULL REFERENCES mkt_variants(id), name text NOT NULL, variant_label text NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 10), unit_price integer NOT NULL CHECK(unit_price > 0),
 discount integer NOT NULL CHECK(discount >= 0), total integer NOT NULL CHECK(total >= 0),
 refunded_qty integer NOT NULL DEFAULT 0 CHECK(refunded_qty >= 0 AND refunded_qty <= quantity),
 shipped_qty integer NOT NULL DEFAULT 0 CHECK(shipped_qty >= 0 AND shipped_qty <= quantity),
 UNIQUE(order_id,variant_id), CHECK(total = quantity * unit_price - discount)
);
CREATE TABLE IF NOT EXISTS mkt_reservations (
 order_id text NOT NULL REFERENCES mkt_orders(id), variant_id text NOT NULL REFERENCES mkt_variants(id),
 quantity integer NOT NULL CHECK(quantity >= 0), status text NOT NULL CHECK(status IN ('HELD','ALLOCATED','RELEASED','SHIPPED')),
 PRIMARY KEY(order_id,variant_id)
);
CREATE TABLE IF NOT EXISTS mkt_payments (
 order_id text PRIMARY KEY REFERENCES mkt_orders(id), payment_key text UNIQUE, status text NOT NULL,
 amount integer NOT NULL CHECK(amount > 0), deposit_secret text, data jsonb NOT NULL DEFAULT '{}', updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mkt_payment_events (
 event_key text PRIMARY KEY, order_id text NOT NULL REFERENCES mkt_orders(id), status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mkt_shipments (
 id text PRIMARY KEY, order_id text NOT NULL REFERENCES mkt_orders(id), carrier text NOT NULL, tracking_number text NOT NULL,
 status text NOT NULL CHECK(status IN ('LABEL_REGISTERED','SHIPPED','DELIVERED')),
 delivered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(carrier,tracking_number)
);
CREATE TABLE IF NOT EXISTS mkt_claims (
 id text PRIMARY KEY, order_id text NOT NULL REFERENCES mkt_orders(id),
 type text NOT NULL CHECK(type IN ('CANCEL','RETURN','EXCHANGE')), status text NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','APPROVED','REJECTED','COMPLETED')),
 reason text NOT NULL, resolution text NOT NULL DEFAULT '', items jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mkt_reviews (
 id text PRIMARY KEY, order_id text NOT NULL REFERENCES mkt_orders(id), product_id text NOT NULL REFERENCES mkt_products(id),
 rating integer NOT NULL CHECK(rating BETWEEN 1 AND 5), content text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(order_id,product_id)
);
CREATE TABLE IF NOT EXISTS mkt_inquiries (
 id text PRIMARY KEY, order_id text REFERENCES mkt_orders(id), subject text NOT NULL, content text NOT NULL,
 reply text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mkt_shipments ADD COLUMN IF NOT EXISTS shipped_at timestamptz;
ALTER TABLE mkt_inquiries ADD COLUMN IF NOT EXISTS replied_at timestamptz;
CREATE INDEX IF NOT EXISTS mkt_shipments_order ON mkt_shipments(order_id);
CREATE INDEX IF NOT EXISTS mkt_inquiries_order ON mkt_inquiries(order_id);
CREATE INDEX IF NOT EXISTS mkt_inquiries_queue ON mkt_inquiries(created_at DESC,id DESC) WHERE reply='';
CREATE TABLE IF NOT EXISTS mkt_audit (
 id text PRIMARY KEY, action text NOT NULL, detail text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mkt_stock_ledger (
 id text PRIMARY KEY, variant_id text NOT NULL REFERENCES mkt_variants(id), on_hand_delta integer NOT NULL DEFAULT 0,
 reserved_delta integer NOT NULL DEFAULT 0, allocated_delta integer NOT NULL DEFAULT 0, reason text NOT NULL, order_id text REFERENCES mkt_orders(id), created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mkt_jobs (
 id text PRIMARY KEY, order_id text REFERENCES mkt_orders(id), kind text NOT NULL, payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','DONE','FAILED')), attempts integer DEFAULT 0, created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mkt_orders_due ON mkt_orders(due_at) WHERE payment_status IN ('PENDING','WAITING_FOR_DEPOSIT');
CREATE INDEX IF NOT EXISTS mkt_order_items_order ON mkt_order_items(order_id);
CREATE INDEX IF NOT EXISTS mkt_claims_order ON mkt_claims(order_id);
CREATE INDEX IF NOT EXISTS mkt_products_category ON mkt_products(category);
-- Customer/order writes are available through authenticated server routes only.
-- Applying this schema does not grant anonymous Supabase clients order access.
ALTER TABLE mkt_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_stock_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mkt_media,mkt_settings,mkt_products,mkt_variants,mkt_coupons,mkt_orders,mkt_order_items,mkt_reservations,mkt_payments,mkt_payment_events,mkt_shipments,mkt_claims,mkt_reviews,mkt_inquiries,mkt_audit,mkt_stock_ledger,mkt_jobs FROM PUBLIC;
