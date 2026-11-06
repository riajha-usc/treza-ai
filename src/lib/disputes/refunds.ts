import { onceForOperation } from "../airwallex/idempotency";
import { recordDecision } from "../audit/audit";
import type { Queryable } from "../db/client";
import { PLATFORM_ACCOUNTS, SELLER_ACCOUNTS } from "../ledger/accounts";
import { postEntry } from "../ledger/ledger";
import { format, toMajor } from "../money/money";
import { PLATFORM_TENANT_ID } from "../tenancy";
import type { DisputeDeps } from "./agent";
import { getOrder } from "./records";

export interface RefundRow {
  id: string;
  order_id: string;
  airwallex_refund_id: string;
  payment_intent_id: string;
  amount_minor: number;
  currency: string;
  status: string;
  reason: string | null;
  issued_by: string;
  created_at: string;
}

export class RefundError extends Error {}

export const listRefunds = (q: Queryable, orderId: string) => q.query<RefundRow>("SELECT * FROM refunds WHERE order_id = $1 ORDER BY created_at", [orderId]);

/**
 * Refunds a buyer through Airwallex Payment Acceptance and records it. The
 * record is what later proves "a refund was issued" in a dispute: a seller
 * saying so never counts, Treza having done it does. Never refunds more
 * than was paid, and a retry can never refund twice.
 */
export async function refundOrder(deps: DisputeDeps, orderId: string, input: { amountMinor?: number; reason: string; by: string; actor: "human" | "system" }): Promise<RefundRow> {
  const { db, gateway } = deps;
  if (!gateway) throw new RefundError("Airwallex is not configured, so no refund can be issued.");
  const order = await getOrder(db, orderId);
  if (!order) throw new RefundError(`Unknown order ${orderId}`);
  if (!order.payment_intent_id) throw new RefundError(`Order ${orderId} was not paid through Airwallex, so Treza cannot refund it.`);
  const cur = order.currency;
  const already = (await listRefunds(db, orderId)).reduce((sum, r) => sum + Number(r.amount_minor), 0);
  const amount = input.amountMinor ?? order.amount_minor - already;
  if (amount <= 0 || already + amount > order.amount_minor) {
    throw new RefundError(`A refund of ${format(Math.max(amount, 0), cur)} would exceed the ${format(order.amount_minor, cur)} paid; ${format(already, cur)} is already refunded.`);
  }
  const { result } = await onceForOperation(db, { key: `refund:${orderId}:${already}`, tenantId: order.seller_tenant_id, method: "POST", path: "/api/v1/pa/refunds/create" }, (requestId) =>
    gateway.createRefund({ requestId, paymentIntentId: order.payment_intent_id!, amount: toMajor(amount, cur), currency: cur, reason: input.reason }),
  );
  await db.query(
    `INSERT INTO refunds (order_id, airwallex_refund_id, payment_intent_id, amount_minor, currency, status, reason, issued_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (airwallex_refund_id) DO NOTHING`,
    [orderId, result.id, order.payment_intent_id, amount, cur, result.status, input.reason, input.by],
  );
  // The buyer's money leaves platform cash, and the seller's payable shrinks by the same amount.
  await postEntry(db, {
    idempotencyKey: `refund:${result.id}`,
    kind: "refund",
    description: `Refund to ${order.buyer_name} on order ${orderId}`,
    lines: [
      { tenantId: PLATFORM_TENANT_ID, account: PLATFORM_ACCOUNTS.cash, amountMinor: -amount, currency: cur },
      { tenantId: order.seller_tenant_id, account: SELLER_ACCOUNTS.payable, amountMinor: amount, currency: cur },
    ],
  });
  await recordDecision(db, {
    tenantId: order.seller_tenant_id,
    actor: input.actor,
    action: "order.refunded",
    subjectType: "order",
    subjectId: orderId,
    inputs: { amountMinor: amount, reason: input.reason, by: input.by },
    outcome: { refundId: result.id, status: result.status },
  });
  return (await listRefunds(db, orderId)).find((r) => r.airwallex_refund_id === result.id)!;
}
