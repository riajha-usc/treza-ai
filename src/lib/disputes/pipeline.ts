import { onceForOperation } from "../airwallex/idempotency";
import { recordDecision } from "../audit/audit";
import { PLATFORM_ACCOUNTS } from "../ledger/accounts";
import { toMajor } from "../money/money";
import { evaluateDispute, getDispute, ingestDispute, type DisputeDeps } from "./agent";
import { DEMO_DISPUTES, seedDemoOrders } from "./demo";
import { book, executeDispute } from "./execute";

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

/**
 * Pulls disputes from Airwallex and handles anything new or changed. A
 * payment_dispute webhook triggers the same function once a public URL is set.
 */
export async function processDisputes(deps: DisputeDeps): Promise<string[]> {
  if (!deps.gateway) return ["Airwallex is not configured"];
  const log: string[] = [];
  for (const d of await deps.gateway.listDisputes()) {
    const { row, isNew, changed } = await ingestDispute(deps, d);
    if (!row.order_id) continue;
    if (row.status === "LOST") {
      await book(deps.db, `dispute-loss:${row.id}`, PLATFORM_ACCOUNTS.disputeLosses, row.amount_minor, row.currency, `Lost dispute on order ${row.order_id}`);
    }
    if ((isNew || changed) && row.status === "REQUIRES_RESPONSE") {
      const decision = await evaluateDispute(deps, row.id);
      const result = await executeDispute(deps, row.id);
      log.push(`${row.order_id} (${row.reason_code}, ${row.stage}): ${decision.action}. ${result}`);
    } else if (isNew || changed) {
      log.push(`${row.order_id}: now ${row.stage} ${row.status}`);
    }
  }
  return log.length ? log : ["No new or changed disputes"];
}

/** Sandbox only: pays for the three demo orders and opens a dispute on each. */
export async function stageDemoDisputes(deps: DisputeDeps): Promise<string[]> {
  const { db, gateway, simulator } = deps;
  if (!gateway || !simulator) return ["Sandbox simulation is not configured"];
  await seedDemoOrders(db);
  for (const c of DEMO_DISPUTES) {
    const o = c.order;
    const amount = toMajor(Math.round(o.amount * 100), "USD");
    const { result: pi } = await onceForOperation(db, { key: `pi:${o.id}`, method: "POST", path: "/api/v1/pa/payment_intents/create" }, (requestId) =>
      gateway.createPaymentIntent({ requestId, amount, currency: "USD", merchantOrderId: o.id }),
    );
    await db.query("UPDATE orders SET payment_intent_id = $2 WHERE id = $1 AND payment_intent_id IS NULL", [o.id, pi.id]);
    await onceForOperation(db, { key: `pi-confirm:${o.id}`, method: "POST", path: "/api/v1/pa/payment_intents/confirm" }, (requestId) =>
      simulator.payWithTestCard(pi.id, requestId),
    );
    await onceForOperation(db, { key: `dispute-sim:${o.id}`, method: "POST", path: "/api/v1/simulation/pa/payment_disputes/create" }, () =>
      simulator.createDispute({ paymentIntentId: pi.id, reasonCode: c.reasonCode, stage: "RFI", dueAt: inDays(7), amount }),
    );
  }
  await recordDecision(db, { actor: "system", action: "demo.disputes_staged", subjectType: "demo", subjectId: "kit04", outcome: { orders: DEMO_DISPUTES.map((c) => c.order.id) } });
  return processDisputes(deps);
}

/** Sandbox only: the issuer rejects the evidence and the case moves to CHARGEBACK. */
export async function simulateIssuerRejection(deps: DisputeDeps, disputeId: string): Promise<string[]> {
  if (!deps.simulator) return ["Sandbox simulation is not configured"];
  const d = await getDispute(deps.db, disputeId);
  await deps.simulator.escalateDispute(d.airwallex_dispute_id, inDays(7));
  return processDisputes(deps);
}

/** Sandbox only: the network rules on the dispute. */
export async function simulateResolution(deps: DisputeDeps, disputeId: string, inFavorOf: "MERCHANT" | "CUSTOMER"): Promise<string[]> {
  if (!deps.simulator) return ["Sandbox simulation is not configured"];
  const d = await getDispute(deps.db, disputeId);
  await deps.simulator.resolveDispute(d.airwallex_dispute_id, inFavorOf);
  return processDisputes(deps);
}
