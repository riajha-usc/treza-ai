import { onceForOperation } from "../airwallex/idempotency";
import { recordDecision } from "../audit/audit";
import { emit } from "../events/bus";
import { PLATFORM_ACCOUNTS, SELLER_ACCOUNTS } from "../ledger/accounts";
import { postEntry } from "../ledger/ledger";
import { toMajor } from "../money/money";
import { loadRiskTier } from "../purchases/policy";
import { PLATFORM_TENANT_ID } from "../tenancy";
import { exposureMinor, openDisputesMinor, sellerPosition, sellers, wait, type SettlementDeps } from "./deps";
import { computeReserve, DEFAULT_RESERVE_POLICY } from "./reserves";

export const TAKE_RATE_BPS = 1_000;
const CUR = "USD";
const DAY = 86_400_000;

/** Finds the platform's own USD Global Account, where buyer payments land. */
export async function platformGlobalAccount(deps: SettlementDeps): Promise<string> {
  const accounts = await deps.gateway!.listGlobalAccounts();
  const ga = accounts.find((a) => a.status === "ACTIVE" && (!a.currency || a.currency === CUR)) ?? accounts[0];
  if (!ga) throw new Error("The platform has no Global Account to receive buyer payments");
  return ga.id;
}

export async function platformAvailableMinor(deps: SettlementDeps): Promise<number> {
  const usd = (await deps.gateway!.balances()).find((b) => b.currency === CUR);
  return Math.round((usd?.available_amount ?? 0) * 100);
}

/**
 * Settles one cycle: buyer payments land in the platform wallet, each seller's
 * reserve is set from that seller's own risk, anything the seller owes is
 * netted, and the rest is paid to the seller's connected account once.
 */
export async function runSettlementCycle(
  deps: SettlementDeps,
  cycleId: string,
  sales: { tenantId: string; grossMinor: number; refundsMinor: number }[],
): Promise<string[]> {
  const { db, gateway } = deps;
  if (!gateway) return ["Airwallex platform access is not configured"];
  const [existing] = await db.query<{ status: string }>("SELECT status FROM settlement_cycles WHERE id = $1", [cycleId]);
  if (existing?.status === "settled") return [`Cycle ${cycleId} is already settled`];
  const collected = sales.reduce((s, x) => s + x.grossMinor - x.refundsMinor, 0);
  if (!existing) {
    await db.query("INSERT INTO settlement_cycles (id, baseline_minor, deposit_minor) VALUES ($1, $2, $3)", [cycleId, await platformAvailableMinor(deps), collected]);
  }

  // Buyer payments for the cycle arrive in the platform wallet.
  if (deps.simulator) {
    const ga = await platformGlobalAccount(deps);
    await onceForOperation(db, { key: `cycle:${cycleId}:deposit`, method: "POST", path: "/api/v1/simulation/deposit/create" }, () =>
      deps.simulator!.deposit({ globalAccountId: ga, amount: toMajor(collected, CUR), reference: `Buyer payments ${cycleId}` }),
    );
  }

  const log: string[] = [];
  const bySeller = new Map((await sellers(db)).map((s) => [s.id, s]));
  for (const sale of sales) {
    const seller = bySeller.get(sale.tenantId);
    if (!seller) continue;
    const fee = Math.round((sale.grossMinor * TAKE_RATE_BPS) / 10_000);
    const net = sale.grossMinor - fee - sale.refundsMinor;
    await postEntry(db, {
      idempotencyKey: `cycle:${cycleId}:collect:${seller.id}`,
      kind: "settlement",
      description: `Buyer payments for ${seller.name}, ${cycleId}`,
      lines: [
        { tenantId: PLATFORM_TENANT_ID, account: PLATFORM_ACCOUNTS.cash, amountMinor: sale.grossMinor - sale.refundsMinor, currency: CUR },
        { tenantId: seller.id, account: SELLER_ACCOUNTS.payable, amountMinor: -net, currency: CUR },
        { tenantId: PLATFORM_TENANT_ID, account: PLATFORM_ACCOUNTS.revenue, amountMinor: -fee, currency: CUR },
      ],
    });

    const risk = await loadRiskTier(db, seller.id);
    const reserve = computeReserve({
      currency: CUR,
      grossMinor: sale.grossMinor,
      trailingRefundRateBps: seller.trailing_refund_rate_bps,
      accountAgeDays: Math.floor((Date.now() - Date.parse(seller.first_sale_at)) / DAY),
      riskTier: risk.tier,
      openDisputesMinor: await openDisputesMinor(db, seller.id),
      exposureMinor: await exposureMinor(db, seller.id),
    }, DEFAULT_RESERVE_POLICY);
    const pos = await sellerPosition(db, seller.id, CUR);
    // Hold more, or release, so the reserve matches the target. Never hold more than this cycle's earnings plus what is already held.
    const change = Math.min(reserve.targetMinor - pos.reserveMinor, pos.payableMinor);
    if (change !== 0) {
      await postEntry(db, {
        idempotencyKey: `cycle:${cycleId}:reserve:${seller.id}`,
        kind: "reserve",
        description: `${change > 0 ? "Hold" : "Release"} reserve for ${seller.name}`,
        lines: [
          { tenantId: seller.id, account: SELLER_ACCOUNTS.payable, amountMinor: change, currency: CUR },
          { tenantId: seller.id, account: SELLER_ACCOUNTS.reserve, amountMinor: -change, currency: CUR },
        ],
      });
    }
    // Anything the seller still owes the platform comes out of this payout.
    const owed = Math.min(pos.receivableMinor, pos.payableMinor - change);
    if (owed > 0) {
      await postEntry(db, {
        idempotencyKey: `cycle:${cycleId}:net-receivable:${seller.id}`,
        kind: "receivable",
        description: `Net amount owed by ${seller.name} from payout`,
        lines: [
          { tenantId: seller.id, account: SELLER_ACCOUNTS.payable, amountMinor: owed, currency: CUR },
          { tenantId: seller.id, account: SELLER_ACCOUNTS.receivable, amountMinor: -owed, currency: CUR },
        ],
      });
      reserve.explanation.push(`Netted ${toMajor(owed, CUR).toFixed(2)} the seller owed from an earlier shortfall`);
    }
    const payout = pos.payableMinor - change - Math.max(0, owed);
    let transfer: { id: string; status: string } | null = null;
    if (payout > 0 && seller.airwallex_account_id) {
      ({ result: transfer } = await onceForOperation(
        db,
        { key: `payout:${cycleId}:${seller.id}`, tenantId: seller.id, method: "POST", path: "/api/v1/connected_account_transfers/create" },
        (requestId) => gateway.transferToSeller({ requestId, destination: seller.airwallex_account_id!, amount: toMajor(payout, CUR), currency: CUR, reason: "goods_purchased", reference: `Treza payout ${cycleId}` }),
      ));
      await postEntry(db, {
        idempotencyKey: `payout:${cycleId}:${seller.id}`,
        kind: "payout",
        description: `Payout to ${seller.name}, ${cycleId}`,
        lines: [
          { tenantId: seller.id, account: SELLER_ACCOUNTS.payable, amountMinor: payout, currency: CUR },
          { tenantId: PLATFORM_TENANT_ID, account: PLATFORM_ACCOUNTS.cash, amountMinor: -payout, currency: CUR },
        ],
      });
      // Transfers start as NEW; read them back until they settle.
      for (let i = 0; i < 5 && transfer.status !== "SETTLED"; i++) {
        await wait(deps, 1_000);
        transfer = await gateway.getTransfer(transfer.id);
      }
    } else if (!seller.airwallex_account_id) reserve.explanation.push("Payout waits: the seller has no connected account yet");

    await db.query(
      `INSERT INTO settlement_lines (cycle_id, tenant_id, currency, gross_minor, fee_minor, refunds_minor, reserve_rate_bps,
         reserve_target_minor, reserve_change_minor, payout_minor, explanation, transfer_id, transfer_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (cycle_id, tenant_id) DO NOTHING`,
      [cycleId, seller.id, CUR, sale.grossMinor, fee, sale.refundsMinor, reserve.rateBps, reserve.targetMinor, change, transfer ? payout : 0, JSON.stringify(reserve.explanation), transfer?.id ?? null, transfer?.status ?? null],
    );
    await recordDecision(db, {
      tenantId: seller.id,
      actor: "rules",
      action: "settlement.reserve_set",
      subjectType: "settlement",
      subjectId: `${cycleId}:${seller.id}`,
      inputs: { gross: sale.grossMinor, riskTier: risk.tier },
      outcome: { rateBps: reserve.rateBps, targetMinor: reserve.targetMinor, change, payout, transfer: transfer?.status ?? null },
      reasoningSummary: reserve.explanation.join("; "),
    });
    log.push(`${seller.name}: reserve ${(reserve.rateBps / 100).toFixed(1)}%, paid ${toMajor(transfer ? payout : 0, CUR).toFixed(2)} (${transfer?.status ?? "not sent"})`);
  }
  await db.query("UPDATE settlement_cycles SET status = 'settled', settled_at = now() WHERE id = $1", [cycleId]);
  await emit(db, { key: `settlement:${cycleId}`, type: "settlement.cycle_settled", payload: { cycleId } });
  return log;
}
