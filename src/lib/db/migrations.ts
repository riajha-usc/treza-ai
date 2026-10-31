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
];
