/**
 * Schema migrations, kept in code so they ship inside any serverless bundle.
 * Never edit a migration that has been applied; add a new one instead.
 */
export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "001_foundation",
    sql: `
-- Tenants: the platform itself plus every connected account it serves.
CREATE TABLE tenants (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('platform', 'seller', 'customer')),
  name text NOT NULL,
  airwallex_account_id text UNIQUE,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Double-entry ledger. Each account belongs to exactly one tenant.
CREATE TABLE ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES tenants(id),
  code text NOT NULL,
  type text NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code, currency)
);

CREATE TABLE journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  kind text NOT NULL,
  description text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Positive amount is a debit, negative is a credit, in integer minor units.
CREATE TABLE postings (
  id bigserial PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES journal_entries(id),
  account_id uuid NOT NULL REFERENCES ledger_accounts(id),
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  currency char(3) NOT NULL
);
CREATE INDEX postings_account_idx ON postings (account_id);
CREATE INDEX postings_entry_idx ON postings (entry_id);

-- Every entry must balance to zero per currency, checked at commit time.
CREATE FUNCTION assert_entry_balanced() RETURNS trigger AS $$
DECLARE unbalanced int;
BEGIN
  SELECT count(*) INTO unbalanced FROM (
    SELECT currency FROM postings WHERE entry_id = NEW.entry_id
    GROUP BY currency HAVING sum(amount_minor) <> 0
  ) t;
  IF unbalanced > 0 THEN
    RAISE EXCEPTION 'journal entry % does not balance', NEW.entry_id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER postings_balanced
  AFTER INSERT ON postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_entry_balanced();

-- Financial history is append-only. Corrections are new reversing entries.
CREATE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_append_only BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER postings_append_only BEFORE UPDATE OR DELETE ON postings
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Shared event ledger: inbound webhooks and internal domain events.
-- (source, external_id) is unique, which is what deduplicates webhooks.
CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('airwallex', 'treza')),
  external_id text NOT NULL,
  type text NOT NULL,
  tenant_id text REFERENCES tenants(id),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processed', 'failed', 'ignored')),
  attempts int NOT NULL DEFAULT 0,
  error text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (source, external_id)
);
CREATE INDEX events_status_idx ON events (status, occurred_at);
CREATE INDEX events_tenant_idx ON events (tenant_id, occurred_at);

-- Audit trail: every decision, by rules, model, human or system.
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  tenant_id text REFERENCES tenants(id),
  actor text NOT NULL CHECK (actor IN ('rules', 'model', 'human', 'system')),
  action text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  inputs jsonb NOT NULL DEFAULT '{}',
  model text,
  prompt_version text,
  reasoning_summary text,
  outcome jsonb NOT NULL DEFAULT '{}',
  latency_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_subject_idx ON audit_log (subject_type, subject_id);
CREATE INDEX audit_tenant_idx ON audit_log (tenant_id, created_at);
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Human approval queue for actions above configured thresholds.
CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES tenants(id),
  kind text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  amount_minor bigint,
  currency char(3),
  reason text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text
);
CREATE UNIQUE INDEX approvals_one_pending ON approvals (kind, subject_type, subject_id)
  WHERE status = 'pending';

-- Outbound money-moving calls. One logical operation maps to one request_id
-- forever, so a retry can never become a second payment.
CREATE TABLE outbound_requests (
  op_key text PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id text REFERENCES tenants(id),
  method text NOT NULL,
  path text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed', 'unknown')),
  response jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    id: "002_purchases_and_cards",
    sql: `
-- Spend policy per tenant, validated in code by a zod schema.
CREATE TABLE tenant_policies (
  tenant_id text PRIMARY KEY REFERENCES tenants(id),
  policy jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Risk tier per tenant. Written by the settlement and dispute agents,
-- read by the purchase agent: this table is one edge of the closed loop.
CREATE TABLE tenant_risk (
  tenant_id text PRIMARY KEY REFERENCES tenants(id),
  tier text NOT NULL DEFAULT 'low' CHECK (tier IN ('low', 'elevated', 'high', 'restricted')),
  score int NOT NULL DEFAULT 0,
  reasons jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Cash the tenant holds now, and what it owes or expects by week.
CREATE TABLE cash_positions (
  tenant_id text NOT NULL REFERENCES tenants(id),
  currency char(3) NOT NULL,
  balance_minor bigint NOT NULL,
  source text NOT NULL DEFAULT 'seed' CHECK (source IN ('seed', 'airwallex')),
  as_of timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, currency)
);

CREATE TABLE cash_flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES tenants(id),
  week int NOT NULL CHECK (week >= 1),
  amount_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  description text NOT NULL
);
CREATE INDEX cash_flows_tenant_idx ON cash_flows (tenant_id, week);

CREATE TABLE cardholders (
  tenant_id text PRIMARY KEY REFERENCES tenants(id),
  airwallex_cardholder_id text NOT NULL UNIQUE,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES tenants(id),
  requester text NOT NULL,
  vendor text NOT NULL,
  merchant_category_code char(4) NOT NULL,
  purpose text NOT NULL,
  terms_text text NOT NULL,
  currency char(3) NOT NULL,
  options jsonb NOT NULL DEFAULT '[]',
  analysis jsonb NOT NULL DEFAULT '{}',
  decision jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'received' CHECK (status IN
    ('received', 'pending_approval', 'approved', 'denied', 'card_issued', 'failed')),
  fingerprint text,
  approval_id uuid REFERENCES approvals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_requests_tenant_idx ON purchase_requests (tenant_id, created_at DESC);

CREATE TABLE cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES tenants(id),
  purchase_request_id uuid REFERENCES purchase_requests(id),
  airwallex_card_id text NOT NULL UNIQUE,
  status text NOT NULL,
  controls jsonb NOT NULL,
  masked_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cards_tenant_idx ON cards (tenant_id);

CREATE TABLE card_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES tenants(id),
  card_id uuid REFERENCES cards(id),
  airwallex_card_id text NOT NULL,
  airwallex_transaction_id text NOT NULL UNIQUE,
  kind text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'declined', 'pending', 'reversed', 'refunded')),
  amount_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  merchant_category_code text,
  merchant_name text,
  failure_reason text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX card_transactions_card_idx ON card_transactions (card_id, occurred_at)`,
  },
  {
    id: "003_orders_and_disputes",
    sql: `
-- Marketplace orders. Buyers pay the platform; each order belongs to a seller.
CREATE TABLE orders (
  id text PRIMARY KEY,
  seller_tenant_id text NOT NULL REFERENCES tenants(id),
  buyer_name text NOT NULL,
  buyer_email text NOT NULL,
  amount_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  channel text NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'agent')),
  device_fingerprint text,
  ip_address text,
  billing_address text NOT NULL,
  shipping_address text NOT NULL,
  carrier text,
  tracking_number text,
  shipped_at timestamptz,
  delivered_at timestamptz,
  -- Name the carrier recorded at delivery, if a signature was taken.
  signed_by text,
  payment_intent_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_seller_idx ON orders (seller_tenant_id, created_at);

-- Source documents the dispute agent may cite: receipts, carrier logs,
-- support threads. Evidence can only ever come from these rows.
CREATE TABLE order_documents (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id),
  kind text NOT NULL CHECK (kind IN ('receipt', 'carrier_log', 'support_thread', 'delivery_confirmation', 'device_history')),
  title text NOT NULL,
  body text NOT NULL,
  -- Documents that arrive later, such as a carrier signature record.
  available_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_documents_order_idx ON order_documents (order_id);

CREATE TABLE disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  airwallex_dispute_id text NOT NULL UNIQUE,
  payment_intent_id text NOT NULL,
  order_id text REFERENCES orders(id),
  seller_tenant_id text REFERENCES tenants(id),
  amount_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  reason_type text,
  reason_code text,
  stage text NOT NULL,
  status text NOT NULL,
  due_at timestamptz,
  decision jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Every accept or challenge sent to Airwallex. The evidence hash makes it
-- impossible to resubmit the same evidence after an issuer rejects it.
CREATE TABLE dispute_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id uuid NOT NULL REFERENCES disputes(id),
  stage text NOT NULL,
  action text NOT NULL CHECK (action IN ('challenge', 'accept')),
  evidence_hash text,
  document_ids jsonb NOT NULL DEFAULT '[]',
  file_ids jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dispute_id, evidence_hash)
)`,
  },
];
