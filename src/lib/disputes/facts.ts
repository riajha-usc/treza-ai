import { instructionsToReviewer } from "../untrusted";

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

/**
 * Which kind of source can establish each fact. A quote proves the words
 * exist, not that the right party wrote them: a carrier proves delivery, a
 * support thread proves what the customer said, and only Treza's own records
 * prove a refund. A seller's own statement proves nothing on its own.
 */
export const SOURCE_KINDS: Record<FactCode, readonly string[]> = {
  prior_orders_same_device: ["order_record", "device_history"],
  prior_orders_same_ip: ["order_record", "device_history"],
  agent_authorization_verified: ["order_record"],
  delivery_signed: ["order_record", "carrier_log", "delivery_confirmation"],
  delivered_to_billing_address: ["order_record", "carrier_log", "delivery_confirmation"],
  tracking_shows_delivered: ["order_record", "carrier_log", "delivery_confirmation"],
  delivered_without_signature: ["order_record", "carrier_log", "delivery_confirmation"],
  return_received: ["order_record", "carrier_log", "delivery_confirmation"],
  customer_confirmed_receipt: ["support_thread"],
  customer_contacted_support: ["support_thread"],
  support_replied: ["support_thread"],
  refund_issued: ["order_record"],
};

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export interface FlaggedDocument {
  id: string;
  /** The phrase addressed to the reviewer. */
  phrase: string;
}

/**
 * Keeps only facts whose quote appears verbatim in the document they cite,
 * whose document can establish that kind of fact, and whose document does
 * not try to instruct the reviewer. The agent compiles evidence that exists;
 * it never creates, alters or takes orders from it.
 */
export function verifyFacts(
  documents: { id: string; kind: string; body: string }[],
  facts: Fact[],
): { verified: Fact[]; rejected: { fact: Fact; reason: string }[]; flagged: FlaggedDocument[] } {
  const byId = new Map(documents.map((d) => [d.id, d]));
  const flagged: FlaggedDocument[] = [];
  for (const d of documents) {
    const phrase = instructionsToReviewer(d.body);
    if (phrase) flagged.push({ id: d.id, phrase });
  }
  const flaggedIds = new Set(flagged.map((f) => f.id));
  const verified: Fact[] = [];
  const rejected: { fact: Fact; reason: string }[] = [];
  for (const f of facts) {
    const refuse = (reason: string) => rejected.push({ fact: f, reason });
    if (!(f.code in FACTS)) refuse("unknown fact");
    else if (!byId.has(f.source)) refuse("cited document does not exist");
    else if (!f.quote.trim() || !squash(byId.get(f.source)!.body).includes(squash(f.quote))) refuse("quote not found in the cited document");
    else if (flaggedIds.has(f.source)) refuse("the cited document contains instructions aimed at the reviewer, so it is not evidence");
    else if (!SOURCE_KINDS[f.code].includes(byId.get(f.source)!.kind)) refuse(`a ${byId.get(f.source)!.kind.replace("_", " ")} cannot establish this fact`);
    else verified.push(f);
  }
  return { verified, rejected, flagged };
}
