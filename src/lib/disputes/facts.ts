/**
 * Facts the dispute agent may rely on. Each fact needs a source: a verbatim
 * quote from an order document, or a value from Treza's own order records.
 */
export const FACTS = {
  prior_orders_same_device: "Earlier undisputed orders came from the same device",
  prior_orders_same_ip: "Earlier undisputed orders came from the same IP address",
  delivery_signed: "The carrier recorded a signature at delivery",
  delivered_to_billing_address: "The order was delivered to the billing address",
  tracking_shows_delivered: "Carrier tracking shows the parcel delivered",
  delivered_without_signature: "Delivered with a scan only, no signature",
  customer_confirmed_receipt: "The customer confirmed they received the order",
  customer_contacted_support: "The customer contacted support about this order",
  support_replied: "Support replied to the customer",
  return_received: "The merchant received the returned item",
  refund_issued: "A refund was issued",
  agent_authorization_verified: "A verified agent placed the order with the customer's approval",
} as const;

export type FactCode = keyof typeof FACTS;

export interface Fact {
  code: FactCode;
  /** Order document id, or "order_record" for Treza's structured data. */
  source: string;
  /** Verbatim text from the source document, or the structured value. */
  quote: string;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Keeps only facts whose quote appears verbatim in the document they cite.
 * The agent compiles evidence that exists; it never creates or alters it.
 */
export function verifyFacts(
  documents: { id: string; body: string }[],
  facts: Fact[],
): { verified: Fact[]; rejected: { fact: Fact; reason: string }[] } {
  const byId = new Map(documents.map((d) => [d.id, squash(d.body)]));
  const verified: Fact[] = [];
  const rejected: { fact: Fact; reason: string }[] = [];
  for (const f of facts) {
    if (!(f.code in FACTS)) {
      rejected.push({ fact: f, reason: "unknown fact" });
      continue;
    }
    const body = byId.get(f.source);
    if (!body) rejected.push({ fact: f, reason: "cited document does not exist" });
    else if (!f.quote.trim() || !body.includes(squash(f.quote))) rejected.push({ fact: f, reason: "quote not found in the cited document" });
    else verified.push(f);
  }
  return { verified, rejected };
}
