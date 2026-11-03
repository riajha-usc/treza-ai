import type { Queryable } from "../db/client";
import { publicKeyFor } from "./keys";
import { verifyObject, verifyRequest, type Check } from "./tap";

/** A demo SaaS merchant that accepts verified agent checkouts. */
export const MERCHANT_CHECKOUT_URL = "https://checkout.parcelwise.example/api/checkout";

export interface CheckoutBody {
  order: { merchantName: string; amount: number; currency: string; plan: string };
  agenticConsumer: Record<string, unknown>;
  agenticPaymentContainer: Record<string, unknown> & { cardMetadata?: { lastFour?: string | null } };
  /** Treza's own references, so the issuer side can match the intent. */
  treza: { cardId: string; instructionId: string };
}

async function claimNonce(q: Queryable, nonce: string): Promise<boolean> {
  await q.query("DELETE FROM tap_nonces WHERE seen_at < now() - interval '8 minutes'");
  const rows = await q.query("INSERT INTO tap_nonces (nonce) VALUES ($1) ON CONFLICT DO NOTHING RETURNING nonce", [nonce]);
  return rows.length === 1;
}

/**
 * The merchant's checkout endpoint. It verifies the TAP request signature,
 * then the consumer and payment objects, which must share the header's nonce
 * and key. A verified checkout is recorded as the agent's signed intent.
 */
export async function handleMerchantCheckout(q: Queryable, req: Request, now?: number): Promise<{ status: number; checks: Check[]; checkoutId?: string }> {
  const body = (await req.json()) as CheckoutBody;
  const tap = await verifyRequest(req, { resolveKey: (kid) => publicKeyFor(q, kid), claimNonce: (n) => claimNonce(q, n), now });
  const checks = [...tap.checks];
  let ok = tap.ok && tap.tag === "agent-payer-auth";
  if (tap.ok && tap.tag !== "agent-payer-auth") checks.push({ name: "checkout tag", pass: false, detail: "Checkout needs agent-payer-auth" });

  if (ok) {
    const key = await publicKeyFor(q, tap.keyid!);
    for (const [name, obj] of [["consumer object", body.agenticConsumer], ["payment container", body.agenticPaymentContainer]] as const) {
      const linked = obj?.nonce === tap.nonce && obj?.kid === tap.keyid;
      const signed = Boolean(key && obj && verifyObject(obj, key));
      const pass = linked && signed;
      checks.push({ name, pass, detail: !linked ? "Nonce or key does not match the request signature" : signed ? "Signed by the same agent key, same session nonce" : "Signature does not verify" });
      ok &&= pass;
    }
    const lastFour = body.agenticPaymentContainer?.cardMetadata?.lastFour;
    checks.push({ name: "card metadata", pass: Boolean(lastFour), detail: lastFour ? `Visa card ending ${lastFour}` : "No card metadata" });
    ok &&= Boolean(lastFour);
  }

  const [row] = await q.query<{ id: string }>(
    `INSERT INTO agent_checkouts (card_id, instruction_id, merchant, amount_minor, currency, verified, checks, nonce)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [body.treza?.cardId ?? null, body.treza?.instructionId ?? null, body.order.merchantName, Math.round(body.order.amount * 100), body.order.currency, ok, JSON.stringify(checks), tap.nonce ?? null],
  );
  return { status: ok ? 200 : 401, checks, checkoutId: row.id };
}
