import type { Db } from "../db/client";
import type { EventRow } from "../events/bus";
import { toMinor } from "../money/money";
import { bookPlatformCardSpend } from "../purchases/agent";

interface IssuingObject {
  id?: string;
  transaction_id?: string;
  card_id?: string;
  status?: string;
  transaction_type?: string;
  failure_reason?: string | null;
  transaction_amount?: number;
  transaction_currency?: string;
  billing_amount?: number;
  billing_currency?: string;
  merchant?: { name?: string; category_code?: string };
}

/**
 * Records card authorizations and clearings reported by Airwallex. The
 * guide warns that REST statuses can lag, so a CLEARING type counts as
 * accepted and a failure_reason counts as declined.
 */
export async function onIssuingTransaction(event: EventRow, db: Db): Promise<void> {
  const obj = (event.payload as { data?: { object?: IssuingObject } }).data?.object ?? {};
  const txId = obj.transaction_id ?? obj.id;
  if (!txId || !obj.card_id) throw new Error(`issuing event ${event.external_id} has no transaction or card id`);
  const [card] = await db.query<{ id: string; tenant_id: string; on_platform: boolean }>(
    "SELECT id, tenant_id, on_behalf_of IS NULL AS on_platform FROM cards WHERE airwallex_card_id = $1",
    [
    obj.card_id,
  ]);
  if (!card) return; // A card Treza did not issue. Nothing to reconcile.
  const currency = (obj.billing_currency ?? obj.transaction_currency ?? "USD").toUpperCase();
  const amount = Math.abs(Number(obj.billing_amount ?? obj.transaction_amount ?? 0));
  const declined = Boolean(obj.failure_reason) || /declin|fail/.test(event.type);
  const outcome = declined
    ? "declined"
    : obj.transaction_type === "REVERSAL"
      ? "reversed"
      : obj.transaction_type === "REFUND"
        ? "refunded"
        : obj.transaction_type === "CLEARING" || /clear|succeed/.test(event.type)
          ? "accepted"
          : "pending";
  await db.query(
    `INSERT INTO card_transactions (tenant_id, card_id, airwallex_card_id, airwallex_transaction_id, kind, outcome,
       amount_minor, currency, merchant_category_code, merchant_name, failure_reason, occurred_at, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (airwallex_transaction_id) DO UPDATE SET outcome = EXCLUDED.outcome, failure_reason = EXCLUDED.failure_reason`,
    [
      card.tenant_id,
      card.id,
      obj.card_id,
      txId,
      obj.transaction_type ?? event.type,
      outcome,
      toMinor(amount, currency),
      currency,
      obj.merchant?.category_code ?? null,
      obj.merchant?.name ?? null,
      obj.failure_reason ?? null,
      event.occurred_at,
      JSON.stringify(obj),
    ],
  );
  if (outcome === "accepted" && card.on_platform) await bookPlatformCardSpend(db, txId, toMinor(amount, currency), currency, obj.merchant?.name ?? "card charge");
}
