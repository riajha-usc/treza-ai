import { createHash } from "node:crypto";
import type { Queryable } from "../db/client";
import type { DisputeDocument } from "../models/dispute-model";
import { format } from "../money/money";
import type { Fact } from "./facts";

export interface OrderRow {
  id: string;
  seller_tenant_id: string;
  buyer_name: string;
  buyer_email: string;
  amount_minor: number;
  currency: string;
  channel: "web" | "agent";
  device_fingerprint: string | null;
  ip_address: string | null;
  billing_address: string;
  shipping_address: string;
  carrier: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  signed_by: string | null;
  payment_intent_id: string | null;
}

export interface DisputeRow {
  id: string;
  airwallex_dispute_id: string;
  payment_intent_id: string;
  order_id: string | null;
  seller_tenant_id: string | null;
  amount_minor: number;
  currency: string;
  reason_type: string | null;
  reason_code: string | null;
  stage: string;
  status: string;
  due_at: string | null;
  decision: Record<string, unknown>;
}

export async function getOrder(q: Queryable, id: string): Promise<OrderRow | null> {
  const [o] = await q.query<OrderRow>("SELECT * FROM orders WHERE id = $1", [id]);
  return o ?? null;
}

/** Documents the merchant can see now. Seller-held records appear only once shared. */
export async function availableDocuments(q: Queryable, orderId: string): Promise<DisputeDocument[]> {
  return q.query<DisputeDocument>(
    "SELECT id, kind, title, body FROM order_documents WHERE order_id = $1 AND available_at <= now() ORDER BY id",
    [orderId],
  );
}

/** Asks the seller for records they hold. In the demo the seller shares them at once. */
export async function requestSellerEvidence(q: Queryable, orderId: string): Promise<string[]> {
  const rows = await q.query<{ id: string }>(
    "UPDATE order_documents SET available_at = now() WHERE order_id = $1 AND available_at > now() RETURNING id",
    [orderId],
  );
  return rows.map((r) => r.id);
}

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/**
 * Facts that come from Treza's own structured records rather than from a
 * document: purchase history, delivery and signature. Code derives these;
 * no model is involved.
 */
export async function structuredFacts(q: Queryable, o: OrderRow): Promise<Fact[]> {
  const facts: Fact[] = [];
  const prior = async (column: "device_fingerprint" | "ip_address", value: string | null) =>
    value
      ? q.query<{ id: string }>(
          `SELECT o.id FROM orders o WHERE o.buyer_email = $1 AND o.id <> $2 AND o.${column} = $3
           AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.order_id = o.id) ORDER BY o.created_at`,
          [o.buyer_email, o.id, value],
        )
      : [];
  const sameDevice = await prior("device_fingerprint", o.device_fingerprint);
  if (sameDevice.length >= 2) {
    facts.push({ code: "prior_orders_same_device", source: "order_record", quote: `${sameDevice.length} earlier undisputed orders from device ${o.device_fingerprint}: ${sameDevice.map((r) => r.id).join(", ")}` });
  }
  const sameIp = await prior("ip_address", o.ip_address);
  if (sameIp.length >= 2) {
    facts.push({ code: "prior_orders_same_ip", source: "order_record", quote: `${sameIp.length} earlier undisputed orders from IP ${o.ip_address}: ${sameIp.map((r) => r.id).join(", ")}` });
  }
  if (o.delivered_at) {
    facts.push({ code: "tracking_shows_delivered", source: "order_record", quote: `Delivered ${day(o.delivered_at)} by ${o.carrier ?? "carrier"}, tracking ${o.tracking_number ?? "n/a"}` });
    if (o.signed_by) facts.push({ code: "delivery_signed", source: "order_record", quote: `Signed for by ${o.signed_by} on ${day(o.delivered_at)}` });
    else facts.push({ code: "delivered_without_signature", source: "order_record", quote: `Delivered ${day(o.delivered_at)} with no signature recorded` });
    if (o.billing_address === o.shipping_address) {
      facts.push({ code: "delivered_to_billing_address", source: "order_record", quote: `Shipped to the billing address: ${o.billing_address}` });
    }
  }
  return facts;
}

