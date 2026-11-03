import { onceForOperation } from "../airwallex/idempotency";
import { recordDecision } from "../audit/audit";
import { PLATFORM_ACCOUNTS } from "../ledger/accounts";
import { accountBalance, postEntry } from "../ledger/ledger";
import { format, toMajor } from "../money/money";
import { loadRiskTier, type RiskTier } from "../purchases/policy";
import { PLATFORM_TENANT_ID } from "../tenancy";
import { sellerPosition, sellers, type SettlementDeps } from "./deps";

export interface BridgePolicy {
  /** Total the platform will lend at once. Deliberately less than sellers could ask for. */
  facilityMinor: number;
  perSellerCapMinor: number;
  eligibleTiers: RiskTier[];
}

export const DEFAULT_BRIDGE_POLICY: BridgePolicy = { facilityMinor: 250_000, perSellerCapMinor: 200_000, eligibleTiers: ["low", "elevated"] };

const TIER_ORDER: Record<RiskTier, number> = { low: 0, elevated: 1, high: 2, restricted: 3 };
const CUR = "USD";

export async function requestBridge(deps: SettlementDeps, input: { tenantId: string; amountMinor: number; purpose: string }): Promise<string> {
  const [row] = await deps.db.query<{ id: string }>(
    "INSERT INTO bridges (tenant_id, amount_minor, currency, purpose) VALUES ($1, $2, $3, $4) RETURNING id",
    [input.tenantId, input.amountMinor, CUR, input.purpose],
  );
  return row.id;
}

/**
 * Rations scarce bridge capital across pending requests. Capital never
 * dips into seller reserves: the reserve floor binds before the facility does.
 */
export async function decideBridges(deps: SettlementDeps, policy: BridgePolicy = DEFAULT_BRIDGE_POLICY): Promise<string[]> {
  const { db } = deps;
  const pending = await db.query<{ id: string; tenant_id: string; amount_minor: number; purpose: string }>(
    "SELECT id, tenant_id, amount_minor, purpose FROM bridges WHERE status = 'requested' ORDER BY created_at",
  );
  const all = await sellers(db);
  const [{ outstanding }] = await db.query<{ outstanding: number }>("SELECT COALESCE(SUM(amount_minor), 0)::bigint AS outstanding FROM bridges WHERE status = 'funded'");
  // Platform cash must keep backing every seller's reserve and unpaid balance.
  let held = 0;
  for (const s of all) {
    const p = await sellerPosition(db, s.id, CUR);
    held += p.reserveMinor + p.payableMinor;
  }
  const cash = await accountBalance(db, PLATFORM_TENANT_ID, PLATFORM_ACCOUNTS.cash, CUR);
  let capital = Math.max(0, Math.min(policy.facilityMinor - outstanding, cash - held));

  const ranked = await Promise.all(pending.map(async (b) => ({ ...b, risk: await loadRiskTier(db, b.tenant_id) })));
  ranked.sort((a, b) => TIER_ORDER[a.risk.tier] - TIER_ORDER[b.risk.tier] || a.amount_minor - b.amount_minor);

  const log: string[] = [];
  for (const b of ranked) {
    const seller = all.find((s) => s.id === b.tenant_id);
    let status: "funded" | "deferred" | "denied";
    let reason: string;
    if (!policy.eligibleTiers.includes(b.risk.tier)) {
      status = "denied";
      reason = `Risk tier ${b.risk.tier}: bridges are only for low or elevated risk sellers`;
    } else if (b.amount_minor > policy.perSellerCapMinor) {
      status = "denied";
      reason = `Above the ${format(policy.perSellerCapMinor, CUR)} per-seller cap`;
    } else if (b.amount_minor > capital) {
      status = "deferred";
      reason = `Only ${format(capital, CUR)} of bridge capital is left; deferred until deposits land`;
    } else if (!seller?.airwallex_account_id || !deps.gateway) {
      status = "deferred";
      reason = "The seller has no connected account to receive funds yet";
    } else {
      const { result } = await onceForOperation(db, { key: `bridge:${b.id}`, tenantId: b.tenant_id, method: "POST", path: "/api/v1/connected_account_transfers/create" }, (requestId) =>
        deps.gateway!.transferToSeller({ requestId, destination: seller.airwallex_account_id!, amount: toMajor(b.amount_minor, CUR), currency: CUR, reason: "business_expenses", reference: `Treza bridge: ${b.purpose}` }),
      );
      await postEntry(db, {
        idempotencyKey: `bridge:${b.id}`,
        kind: "bridge",
        description: `Bridge advance to ${seller.name}`,
        lines: [
          { tenantId: PLATFORM_TENANT_ID, account: PLATFORM_ACCOUNTS.bridgeReceivable, amountMinor: b.amount_minor, currency: CUR },
          { tenantId: PLATFORM_TENANT_ID, account: PLATFORM_ACCOUNTS.cash, amountMinor: -b.amount_minor, currency: CUR },
        ],
      });
      await db.query("UPDATE bridges SET transfer_id = $2 WHERE id = $1", [b.id, result.id]);
      capital -= b.amount_minor;
      status = "funded";
      reason = `Funded from the bridge facility; ${format(capital, CUR)} left`;
    }
    await db.query("UPDATE bridges SET status = $2, decision = $3, updated_at = now() WHERE id = $1", [b.id, status, JSON.stringify({ reason, riskTier: b.risk.tier })]);
    await recordDecision(db, { tenantId: b.tenant_id, actor: "rules", action: `bridge.${status}`, subjectType: "bridge", subjectId: b.id, inputs: { amountMinor: b.amount_minor, riskTier: b.risk.tier }, outcome: { reason } });
    log.push(`${seller?.name ?? b.tenant_id} ${format(b.amount_minor, CUR)}: ${status}. ${reason}`);
  }
  return log;
}

/** The seller's late deposit lands; the bridge is charged back after checking the wallet. */
export async function repayBridges(deps: SettlementDeps, tenantId: string, depositMinor: number): Promise<string[]> {
  const { db, gateway, simulator } = deps;
  const seller = (await sellers(db)).find((s) => s.id === tenantId);
  if (!gateway || !seller?.airwallex_account_id) return ["The seller has no connected account"];
  if (simulator && seller.airwallex_global_account_id) {
    await simulator.deposit({ globalAccountId: seller.airwallex_global_account_id, amount: toMajor(depositMinor, CUR), reference: "Late marketplace deposit", onBehalfOf: seller.airwallex_account_id });
  }
  const wallet = (await gateway.balances(seller.airwallex_account_id)).find((b) => b.currency === CUR);
  let available = Math.floor((wallet?.available_amount ?? 0) * 100);
  const log: string[] = [];
  for (const b of await db.query<{ id: string; amount_minor: number }>("SELECT id, amount_minor FROM bridges WHERE tenant_id = $1 AND status = 'funded' ORDER BY created_at", [tenantId])) {
    if (available < b.amount_minor) {
      log.push(`${format(b.amount_minor, CUR)} bridge not yet repaid: wallet holds ${format(available, CUR)}`);
      continue;
    }
    const { result } = await onceForOperation(db, { key: `bridge-repay:${b.id}`, tenantId, method: "POST", path: "/api/v1/charges/create" }, (requestId) =>
      gateway.chargeSeller({ requestId, source: seller.airwallex_account_id!, amount: toMajor(b.amount_minor, CUR), currency: CUR, reason: "loan_credit_repayment", reference: "Treza bridge repayment" }),
    );
    await postEntry(db, {
      idempotencyKey: `bridge-repay:${b.id}`,
      kind: "bridge",
      description: `Bridge repaid by ${seller.name}`,
      lines: [
        { tenantId: PLATFORM_TENANT_ID, account: PLATFORM_ACCOUNTS.cash, amountMinor: b.amount_minor, currency: CUR },
        { tenantId: PLATFORM_TENANT_ID, account: PLATFORM_ACCOUNTS.bridgeReceivable, amountMinor: -b.amount_minor, currency: CUR },
      ],
    });
    await db.query("UPDATE bridges SET status = 'repaid', repay_charge_id = $2, updated_at = now() WHERE id = $1", [b.id, result.id]);
    await recordDecision(db, { tenantId, actor: "system", action: "bridge.repaid", subjectType: "bridge", subjectId: b.id, outcome: { chargeId: result.id } });
    available -= b.amount_minor;
    log.push(`${seller.name} repaid ${format(b.amount_minor, CUR)}`);
  }
  return log;
}

/** Late deposits land for every seller that holds a funded bridge, and each bridge is charged back. */
export async function repayFundedBridges(deps: SettlementDeps, depositMinor: number): Promise<string[]> {
  const holders = await deps.db.query<{ tenant_id: string }>("SELECT DISTINCT tenant_id FROM bridges WHERE status = 'funded' ORDER BY tenant_id");
  if (holders.length === 0) return ["No funded bridge to repay"];
  const log: string[] = [];
  for (const h of holders) log.push(...(await repayBridges(deps, h.tenant_id, depositMinor)));
  return log;
}
