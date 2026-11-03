import type { Queryable } from "../db/client";
import { format } from "../money/money";
import { PLATFORM_ACCOUNTS } from "../ledger/accounts";
import { PLATFORM_TENANT_ID } from "../tenancy";
import { platformAvailableMinor } from "./cycle";
import { sellerPosition, type SettlementDeps } from "./deps";

async function ledgerCashMovedSince(q: Queryable, since: string): Promise<number> {
  const [{ moved }] = await q.query<{ moved: number }>(
    `SELECT COALESCE(SUM(p.amount_minor), 0)::bigint AS moved FROM postings p
     JOIN journal_entries e ON e.id = p.entry_id JOIN ledger_accounts a ON a.id = p.account_id
     WHERE a.tenant_id = $1 AND a.code = $2 AND p.currency = 'USD' AND e.created_at >= $3`,
    [PLATFORM_TENANT_ID, PLATFORM_ACCOUNTS.cash.code, since],
  );
  return moved;
}

/**
 * Reconciles a cycle against Airwallex: every seller's earnings are fully
 * accounted for, every payout settled, and the platform wallet moved by
 * exactly what Treza's ledger says it moved.
 */
export async function reconcileCycle(deps: SettlementDeps, cycleId: string): Promise<{ ok: boolean; findings: string[] }> {
  const { db, gateway } = deps;
  const [cycle] = await db.query<{ created_at: string; baseline_minor: number | null }>("SELECT created_at, baseline_minor FROM settlement_cycles WHERE id = $1", [cycleId]);
  if (!cycle) return { ok: false, findings: [`Unknown cycle ${cycleId}`] };
  const findings: string[] = [];
  let ok = true;
  const lines = await db.query<{ tenant_id: string; gross_minor: number; fee_minor: number; refunds_minor: number; reserve_change_minor: number; payout_minor: number; transfer_id: string | null; transfer_status: string | null }>(
    "SELECT * FROM settlement_lines WHERE cycle_id = $1",
    [cycleId],
  );
  for (const l of lines) {
    const owed = l.gross_minor - l.fee_minor - l.refunds_minor;
    const pos = await sellerPosition(db, l.tenant_id);
    const accounted = l.payout_minor + l.reserve_change_minor + pos.payableMinor;
    if (accounted < owed - 1) {
      ok = false;
      findings.push(`${l.tenant_id}: owed ${format(owed, "USD")} but only ${format(accounted, "USD")} is paid, held or payable`);
    }
    if (l.transfer_id && gateway) {
      const t = await gateway.getTransfer(l.transfer_id);
      if (t.status !== l.transfer_status) await db.query("UPDATE settlement_lines SET transfer_status = $3 WHERE cycle_id = $1 AND tenant_id = $2", [cycleId, l.tenant_id, t.status]);
      if (t.status !== "SETTLED") {
        ok = false;
        findings.push(`${l.tenant_id}: payout ${t.id} is ${t.status}, not settled`);
      }
    }
  }
  if (gateway && cycle.baseline_minor !== null) {
    const walletMoved = (await platformAvailableMinor(deps)) - cycle.baseline_minor;
    const ledgerMoved = await ledgerCashMovedSince(db, cycle.created_at);
    if (walletMoved !== ledgerMoved) {
      ok = false;
      findings.push(`Platform wallet moved ${format(walletMoved, "USD")} but the ledger recorded ${format(ledgerMoved, "USD")}: ${format(walletMoved - ledgerMoved, "USD")} unexplained`);
    } else findings.push(`Platform wallet moved ${format(walletMoved, "USD")}, matching the ledger exactly`);
  }
  if (ok) findings.unshift("Every seller's earnings are paid, held in reserve or payable, and every payout settled");
  await db.query("INSERT INTO reconciliation_runs (ok, findings) VALUES ($1, $2)", [ok, JSON.stringify(findings)]);
  return { ok, findings };
}
