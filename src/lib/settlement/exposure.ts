import { onceForOperation } from "../airwallex/idempotency";
import { recordDecision } from "../audit/audit";
import { PLATFORM_ACCOUNTS, SELLER_ACCOUNTS } from "../ledger/accounts";
import { postEntry } from "../ledger/ledger";
import { format, toMajor } from "../money/money";
import { loadRiskTier } from "../purchases/policy";
import { recordRiskSignal } from "../risk/risk";
import { PLATFORM_TENANT_ID } from "../tenancy";
import { exposureMinor, openDisputesMinor, sellerPosition, sellers, type SettlementDeps } from "./deps";
import { computeReserve } from "./reserves";

/** Share of undelivered order value expected to come back as refunds. */
const REFUND_LIKELIHOOD = 0.7;
const DAY = 86_400_000;

/**
 * New evidence hits one seller after payout, such as a carrier failure.
 * Only that seller's reserve is recalculated. Any shortfall is charged to
 * the seller's wallet after checking its balance, and whatever the wallet
 * cannot cover is recorded as owed and netted from the next payout.
 */
export async function reportCarrierFailure(
  deps: SettlementDeps,
  input: { tenantId: string; carrier: string; undeliveredOrders: number; undeliveredValueMinor: number; refundsRequestedMinor: number },
): Promise<{ exposureMinor: number; targetMinor: number; shortfallMinor: number; chargedMinor: number; owedMinor: number }> {
  const { db } = deps;
  const cur = "USD";
  const seller = (await sellers(db)).find((s) => s.id === input.tenantId);
  if (!seller) throw new Error(`Unknown seller ${input.tenantId}`);
  const remaining = input.undeliveredValueMinor - input.refundsRequestedMinor;
  const exposure = input.refundsRequestedMinor + Math.round(remaining * REFUND_LIKELIHOOD);
  const [event] = await db.query<{ id: string }>(
    `INSERT INTO exposure_events (tenant_id, kind, exposure_minor, refunds_due_minor, currency, details)
     VALUES ($1, 'carrier_failure', $2, $3, $4, $5) RETURNING id`,
    [seller.id, exposure, input.refundsRequestedMinor, cur, JSON.stringify(input)],
  );
  await recordRiskSignal(db, seller.id, {
    key: `carrier:${event.id}`,
    weight: 20,
    reason: `${input.carrier} failure: ${input.undeliveredOrders} parcels undelivered, ${format(input.refundsRequestedMinor, cur)} in refund requests`,
  });

  // Recalculate this seller only, from its latest cycle and the new evidence.
  const [line] = await db.query<{ gross_minor: number }>(
    "SELECT gross_minor FROM settlement_lines WHERE tenant_id = $1 ORDER BY cycle_id DESC LIMIT 1",
    [seller.id],
  );
  const risk = await loadRiskTier(db, seller.id);
  const reserve = computeReserve({
    currency: cur,
    grossMinor: line?.gross_minor ?? 0,
    trailingRefundRateBps: seller.trailing_refund_rate_bps,
    accountAgeDays: Math.floor((Date.now() - Date.parse(seller.first_sale_at)) / DAY),
    riskTier: risk.tier,
    openDisputesMinor: await openDisputesMinor(db, seller.id),
    exposureMinor: await exposureMinor(db, seller.id),
  });
  const pos = await sellerPosition(db, seller.id, cur);
  const shortfall = Math.max(0, reserve.targetMinor - pos.reserveMinor);

  // Check the seller's wallet before charging, as the guide requires.
  let charged = 0;
  if (shortfall > 0 && deps.gateway && seller.airwallex_account_id) {
    const wallet = (await deps.gateway.balances(seller.airwallex_account_id)).find((b) => b.currency === cur);
    const available = Math.floor((wallet?.available_amount ?? 0) * 100);
    charged = Math.min(shortfall, available);
    if (charged > 0) {
      await onceForOperation(db, { key: `recover:${event.id}`, tenantId: seller.id, method: "POST", path: "/api/v1/charges/create" }, (requestId) =>
        deps.gateway!.chargeSeller({ requestId, source: seller.airwallex_account_id!, amount: toMajor(charged, cur), currency: cur, reason: "other_services", reference: `Reserve top-up after ${input.carrier} failure` }),
      );
      await postEntry(db, {
        idempotencyKey: `recover:${event.id}`,
        kind: "reserve",
        description: `Recovered reserve shortfall from ${seller.name}`,
        lines: [
          { tenantId: PLATFORM_TENANT_ID, account: PLATFORM_ACCOUNTS.cash, amountMinor: charged, currency: cur },
          { tenantId: seller.id, account: SELLER_ACCOUNTS.reserve, amountMinor: -charged, currency: cur },
        ],
      });
    }
  }
  const owed = shortfall - charged;
  if (owed > 0) {
    await postEntry(db, {
      idempotencyKey: `owed:${event.id}`,
      kind: "receivable",
      description: `${seller.name} owes the rest of the reserve shortfall`,
      lines: [
        { tenantId: seller.id, account: SELLER_ACCOUNTS.receivable, amountMinor: owed, currency: cur },
        { tenantId: seller.id, account: SELLER_ACCOUNTS.reserve, amountMinor: -owed, currency: cur },
      ],
    });
  }
  const resolution = { exposureMinor: exposure, targetMinor: reserve.targetMinor, shortfallMinor: shortfall, chargedMinor: charged, owedMinor: owed };
  await db.query("UPDATE exposure_events SET resolution = $2 WHERE id = $1", [event.id, JSON.stringify({ ...resolution, explanation: reserve.explanation })]);
  await recordDecision(db, {
    tenantId: seller.id,
    actor: "rules",
    action: "settlement.exposure_recalculated",
    subjectType: "tenant",
    subjectId: seller.id,
    inputs: { ...input, riskTier: risk.tier },
    outcome: resolution,
    reasoningSummary: reserve.explanation.join("; "),
  });
  return resolution;
}
