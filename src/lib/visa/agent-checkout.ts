import { randomUUID, sign as edSign } from "node:crypto";
import { recordDecision } from "../audit/audit";
import { toMajor } from "../money/money";
import { getPurchase, simulateCharge, type CardRow, type PurchaseDeps } from "../purchases/agent";
import { agentKey, type AgentKey } from "./keys";
import { handleMerchantCheckout, MERCHANT_CHECKOUT_URL, type CheckoutBody } from "./merchant";
import { decideAuthorization, recordAuthorization } from "./remote-auth";
import { signObject, signRequest, type Check } from "./tap";
import { ensureInstruction, type VicClient } from "./vic";

/**
 * honest: signed checkout. replay and forged: attacks the merchant must reject.
 * renewal: a later charge with no new checkout (covered only by a recurring mandate).
 * overcharge: the merchant tries the annual price on a monthly mandate.
 */
export type CheckoutMode = "honest" | "replay" | "forged" | "renewal" | "overcharge";

export interface CheckoutResult {
  mode: CheckoutMode;
  merchantStatus: number | null;
  merchantChecks: Check[];
  authorization: { status: string; reason: string; checks: Check[]; source: "treza_remote_auth" | "airwallex_remote_auth" } | null;
  charge: { outcome: string; failureReason: string | null } | null;
}

const b64url = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");

/** Stand-in for the Visa-signed consumer ID token, signed with the agent key and labeled as such. */
function standInIdToken(key: AgentKey, subject: string): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url({ alg: "EdDSA", kid: key.kid, typ: "JWT" });
  const claims = b64url({ iss: "treza-visa-id-token-stand-in", sub: subject, aud: new URL(MERCHANT_CHECKOUT_URL).host, iat: now, exp: now + 480 });
  const sig = edSign(null, Buffer.from(`${head}.${claims}`), key.privateKey).toString("base64url");
  return `${head}.${claims}.${sig}`;
}

function buildCheckout(key: AgentKey, nonce: string, order: CheckoutBody["order"], lastFour: string | null, refs: CheckoutBody["treza"], subject: string) {
  const base = { nonce, kid: key.kid, alg: "ed25519" };
  const body: CheckoutBody = {
    order,
    agenticConsumer: signObject({ ...base, idToken: standInIdToken(key, subject), contextualData: { countryCode: "US", zip: "78701", ipAddress: "203.0.113.10", deviceData: "treza-purchase-agent" } }, key.privateKey),
    agenticPaymentContainer: signObject({ ...base, cardMetadata: { lastFour, shortDescription: `Treza card for ${order.merchantName}` } }, key.privateKey),
    treza: refs,
  };
  return body;
}

/**
 * The purchase agent checks out at the merchant with a TAP-signed request.
 * The merchant verifies it; then the card authorization is decided against
 * the VIC-style mandate and the verified intent. Modes show the failure
 * cases: a replayed request, a forged signature, and a charge with no
 * signed checkout at all.
 */
export async function agentCheckout(deps: { purchases: PurchaseDeps; vic: VicClient; remoteAuthLive: boolean }, purchaseId: string, mode: CheckoutMode): Promise<CheckoutResult> {
  const { db } = deps.purchases;
  const row = await getPurchase(db, purchaseId);
  const [card] = await db.query<CardRow & { masked_number: string | null }>("SELECT * FROM cards WHERE purchase_request_id = $1", [purchaseId]);
  if (!card || !row.decision.chosen) throw new Error("This purchase has no issued card");
  const ins = await ensureInstruction(db, deps.vic, row, card);
  const key = await agentKey(db);
  const amount = toMajor(row.decision.chosen.chargeMinor, row.currency);
  const order = { merchantName: row.vendor, amount, currency: row.currency, plan: row.decision.chosen.billing };
  const result: CheckoutResult = { mode, merchantStatus: null, merchantChecks: [], authorization: null, charge: null };

  const merchantInitiated = mode === "renewal" || mode === "overcharge";
  const annual = row.options.find((o) => o.billing === "annual");
  const chargeMinor = mode === "overcharge" && annual ? annual.chargeMinor : row.decision.chosen.chargeMinor;
  const chargeAmount = toMajor(chargeMinor, row.currency);
  if (!merchantInitiated) {
    const nonce = randomUUID();
    const body = buildCheckout(key, nonce, order, ins.credential.panLastFour, { cardId: card.id, instructionId: ins.instruction_id }, row.requester);
    let headers: Record<string, string> = signRequest(MERCHANT_CHECKOUT_URL, key, { tag: "agent-payer-auth", nonce });
    if (mode === "forged") headers = { ...headers, signature: headers.signature.replace(/^sig2=:(.)/, (_m, c) => `sig2=:${c === "A" ? "B" : "A"}`) };
    const send = () => handleMerchantCheckout(db, new Request(MERCHANT_CHECKOUT_URL, { method: "POST", headers: { "content-type": "application/json", "signature-input": headers["signature-input"], signature: headers.signature }, body: JSON.stringify(body) }));
    let res = await send();
    if (mode === "replay") res = await send(); // The identical request, sent a second time.
    result.merchantStatus = res.status;
    result.merchantChecks = res.checks;
    await recordDecision(db, { tenantId: row.tenant_id, actor: "system", action: res.status === 200 ? "tap.checkout_verified" : "tap.checkout_rejected", subjectType: "purchase_request", subjectId: row.id, outcome: { mode, failed: res.checks.filter((c) => !c.pass).map((c) => c.name) } });
    if (res.status !== 200) return result;
  }

  // Card authorization. Until Airwallex is configured to call Treza, Treza decides first, as Airwallex would ask it to.
  if (!deps.remoteAuthLive) {
    const payload = { card_id: card.airwallex_card_id, card_transaction_event_id: `local_${randomUUID()}`, transaction_amount: chargeAmount, transaction_currency: row.currency, merchant: { category_code: row.merchant_category_code, name: row.vendor } };
    const started = Date.now();
    const answer = await decideAuthorization(db, payload);
    await recordAuthorization(db, payload, answer, Date.now() - started, row.tenant_id);
    result.authorization = { status: answer.response_status, reason: answer.status_reason, checks: answer.checks, source: "treza_remote_auth" };
    await deps.vic.confirm(ins.instruction_id, { amount: chargeAmount, currency: row.currency, merchantName: row.vendor, status: answer.response_status === "AUTHORIZED" ? "APPROVED" : "DECLINED" });
    if (answer.response_status !== "AUTHORIZED") return result;
  }
  if (deps.purchases.simulator) {
    result.charge = await simulateCharge(deps.purchases, card.id, { amountMinor: chargeMinor, currency: row.currency, merchantCategoryCode: row.merchant_category_code, label: merchantInitiated ? `${row.vendor} ${mode}` : `${row.vendor} agent checkout` });
  }
  return result;
}
