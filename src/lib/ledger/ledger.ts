import type { Queryable } from "../db/client";
import { isDebitNormal, type AccountType } from "./accounts";

export interface PostingLine {
  tenantId: string;
  account: { code: string; type: AccountType };
  /** Positive is a debit, negative is a credit, in integer minor units. */
  amountMinor: number;
  currency: string;
}

export interface EntryInput {
  /** Same key, same entry: reposting is a no-op, never a duplicate. */
  idempotencyKey: string;
  kind: string;
  description: string;
  metadata?: Record<string, unknown>;
  lines: PostingLine[];
}

export class LedgerError extends Error {}

export async function ensureTenant(
  q: Queryable,
  t: { id: string; kind: "platform" | "seller" | "customer"; name: string; airwallexAccountId?: string | null },
): Promise<void> {
  await q.query(
    `INSERT INTO tenants (id, kind, name, airwallex_account_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name,
       airwallex_account_id = COALESCE(EXCLUDED.airwallex_account_id, tenants.airwallex_account_id)`,
    [t.id, t.kind, t.name, t.airwallexAccountId ?? null],
  );
}

async function ensureAccount(
  q: Queryable,
  tenantId: string,
  account: { code: string; type: AccountType },
  currency: string,
): Promise<string> {
  const rows = await q.query<{ id: string; type: AccountType }>(
    `INSERT INTO ledger_accounts (tenant_id, code, type, currency) VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, code, currency) DO UPDATE SET code = EXCLUDED.code
     RETURNING id, type`,
    [tenantId, account.code, account.type, currency],
  );
  if (rows[0].type !== account.type) {
    throw new LedgerError(`Account ${account.code} exists with type ${rows[0].type}, not ${account.type}`);
  }
  return rows[0].id;
}

/** Fails fast with a clear message; the database trigger is the backstop. */
function assertBalanced(lines: PostingLine[]) {
  if (lines.length < 2) throw new LedgerError("A journal entry needs at least two lines");
  const totals = new Map<string, number>();
  for (const l of lines) {
    if (!Number.isSafeInteger(l.amountMinor) || l.amountMinor === 0) {
      throw new LedgerError(`Invalid amount ${l.amountMinor} on ${l.account.code}`);
    }
    totals.set(l.currency, (totals.get(l.currency) ?? 0) + l.amountMinor);
  }
  for (const [currency, total] of totals) {
    if (total !== 0) throw new LedgerError(`Entry does not balance in ${currency}: off by ${total}`);
  }
}

/**
 * Posts a balanced journal entry inside one transaction.
 * Returns created=false when the idempotency key was already used.
 */
export async function postEntry(
  db: { transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> },
  input: EntryInput,
): Promise<{ entryId: string; created: boolean }> {
  assertBalanced(input.lines);
  return db.transaction(async (tx) => {
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO journal_entries (idempotency_key, kind, description, metadata)
       VALUES ($1, $2, $3, $4) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [input.idempotencyKey, input.kind, input.description, JSON.stringify(input.metadata ?? {})],
    );
    if (inserted.length === 0) {
      const existing = await tx.query<{ id: string }>(
        "SELECT id FROM journal_entries WHERE idempotency_key = $1",
        [input.idempotencyKey],
      );
      return { entryId: existing[0].id, created: false };
    }
    const entryId = inserted[0].id;
    for (const line of input.lines) {
      const accountId = await ensureAccount(tx, line.tenantId, line.account, line.currency);
      await tx.query(
        "INSERT INTO postings (entry_id, account_id, amount_minor, currency) VALUES ($1, $2, $3, $4)",
        [entryId, accountId, line.amountMinor, line.currency],
      );
    }
    return { entryId, created: true };
  });
}

export interface AccountBalance {
  code: string;
  type: AccountType;
  currency: string;
  /** Balance in the account's natural direction, so a healthy liability is positive. */
  balanceMinor: number;
}

/** Balances for one tenant only. Every read is scoped to a tenant. */
export async function tenantBalances(q: Queryable, tenantId: string): Promise<AccountBalance[]> {
  const rows = await q.query<{ code: string; type: AccountType; currency: string; raw: number }>(
    `SELECT a.code, a.type, a.currency, COALESCE(SUM(p.amount_minor), 0)::bigint AS raw
     FROM ledger_accounts a LEFT JOIN postings p ON p.account_id = a.id
     WHERE a.tenant_id = $1
     GROUP BY a.id, a.code, a.type, a.currency
     ORDER BY a.code, a.currency`,
    [tenantId],
  );
  return rows.map((r) => ({
    code: r.code,
    type: r.type,
    currency: r.currency,
    // Avoid -0 for an empty credit-normal account.
    balanceMinor: isDebitNormal(r.type) || r.raw === 0 ? r.raw : -r.raw,
  }));
}

export async function accountBalance(
  q: Queryable,
  tenantId: string,
  account: { code: string; type: AccountType },
  currency: string,
): Promise<number> {
  const all = await tenantBalances(q, tenantId);
  return all.find((b) => b.code === account.code && b.currency === currency)?.balanceMinor ?? 0;
}
