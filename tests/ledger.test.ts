import { beforeEach, describe, expect, it } from "vitest";
import { testDb, type Db } from "@/lib/db/client";
import { PLATFORM_ACCOUNTS, SELLER_ACCOUNTS } from "@/lib/ledger/accounts";
import { ensureTenant, LedgerError, postEntry, tenantBalances, accountBalance } from "@/lib/ledger/ledger";

let db: Db;

beforeEach(async () => {
  db = await testDb();
  await ensureTenant(db, { id: "platform", kind: "platform", name: "Platform" });
  await ensureTenant(db, { id: "seller_a", kind: "seller", name: "Seller A" });
  await ensureTenant(db, { id: "seller_b", kind: "seller", name: "Seller B" });
});

const sale = (key: string, minor: number, seller = "seller_a") => ({
  idempotencyKey: key,
  kind: "sale",
  description: "Buyer payment for seller",
  lines: [
    { tenantId: "platform", account: PLATFORM_ACCOUNTS.cash, amountMinor: minor, currency: "USD" },
    { tenantId: seller, account: SELLER_ACCOUNTS.payable, amountMinor: -minor, currency: "USD" },
  ],
});

describe("ledger", () => {
  it("posts a balanced entry and reports natural-direction balances", async () => {
    await postEntry(db, sale("sale:1", 10_000));
    expect(await accountBalance(db, "platform", PLATFORM_ACCOUNTS.cash, "USD")).toBe(10_000);
    expect(await accountBalance(db, "seller_a", SELLER_ACCOUNTS.payable, "USD")).toBe(10_000);
  });

  it("rejects an unbalanced entry before it reaches the database", async () => {
    const bad = sale("sale:bad", 10_000);
    bad.lines[1].amountMinor = -9_999;
    await expect(postEntry(db, bad)).rejects.toBeInstanceOf(LedgerError);
  });

  it("has a database-level backstop against unbalanced postings", async () => {
    await expect(
      db.transaction(async (tx) => {
        const [entry] = await tx.query<{ id: string }>(
          "INSERT INTO journal_entries (idempotency_key, kind, description) VALUES ('raw', 'x', 'x') RETURNING id",
        );
        const [acct] = await tx.query<{ id: string }>(
          "INSERT INTO ledger_accounts (tenant_id, code, type, currency) VALUES ('platform', 'platform_cash', 'asset', 'USD') RETURNING id",
        );
        await tx.query("INSERT INTO postings (entry_id, account_id, amount_minor, currency) VALUES ($1, $2, 500, 'USD')", [
          entry.id,
          acct.id,
        ]);
      }),
    ).rejects.toThrow(/does not balance/);
  });

  it("treats a repeated idempotency key as the same entry", async () => {
    const first = await postEntry(db, sale("sale:2", 2_500));
    const second = await postEntry(db, sale("sale:2", 2_500));
    expect(second.created).toBe(false);
    expect(second.entryId).toBe(first.entryId);
    expect(await accountBalance(db, "platform", PLATFORM_ACCOUNTS.cash, "USD")).toBe(2_500);
  });

  it("refuses to update or delete financial history", async () => {
    await postEntry(db, sale("sale:3", 100));
    await expect(db.query("UPDATE postings SET amount_minor = 1")).rejects.toThrow(/append-only/);
    await expect(db.query("DELETE FROM journal_entries")).rejects.toThrow(/append-only/);
  });

  it("scopes balances to a single tenant", async () => {
    await postEntry(db, sale("sale:a", 700, "seller_a"));
    await postEntry(db, sale("sale:b", 900, "seller_b"));
    const a = await tenantBalances(db, "seller_a");
    expect(a).toEqual([{ code: "seller_payable", type: "liability", currency: "USD", balanceMinor: 700 }]);
  });
});
