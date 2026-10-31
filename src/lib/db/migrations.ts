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
`,
  },
];
