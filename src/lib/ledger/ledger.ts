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

