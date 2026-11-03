import { createHmac, generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { testDb, type Db } from "@/lib/db/client";
import { ensureTenant } from "@/lib/ledger/ledger";
import { submitPurchase, type PurchaseDeps } from "@/lib/purchases/agent";
import { PARCELWISE_TERMS, seedDemo } from "@/lib/seed";
import { agentCheckout } from "@/lib/visa/agent-checkout";
import { decideAuthorization, recordAuthorization, verifyRemoteAuthSignature } from "@/lib/visa/remote-auth";
import { signatureBase, signObject, signRequest, verifyObject, verifyRequest } from "@/lib/visa/tap";
import { StandInVicClient } from "@/lib/visa/vic";
import { FakeIssuer, FakeModel } from "./fakes";

const URL_ = "https://checkout.parcelwise.example/api/checkout";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const key = { kid: "test-kid", privateKey };
const now = Date.parse("2026-11-02T18:00:00Z");

function verify(headers: Record<string, string>, opts: { url?: string; seen?: Set<string>; at?: number; keyFor?: string } = {}) {
  const seen = opts.seen ?? new Set<string>();
  return verifyRequest(
    { url: opts.url ?? URL_, headers: new Headers(headers) },
    {
      resolveKey: async (kid) => (kid === (opts.keyFor ?? "test-kid") ? publicKey : null),
      claimNonce: async (n) => (seen.has(n) ? false : (seen.add(n), true)),
      now: opts.at ?? now + 1_000,
    },
  );
}

describe("Visa TAP signatures (RFC 9421)", () => {
  it("builds the exact RFC 9421 signature base", () => {
    expect(signatureBase("shop.example", "/checkout", '("@authority" "@path");created=1;tag="agent-payer-auth"')).toBe(
      '"@authority": shop.example\n"@path": /checkout\n"@signature-params": ("@authority" "@path");created=1;tag="agent-payer-auth"',
    );
  });

  it("verifies a correctly signed request through every merchant step", async () => {
    const h = signRequest(URL_, key, { tag: "agent-payer-auth", now });
    const r = await verify(h);
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.name)).toEqual(["trusted agent tag", "required fields", "time window", "key lookup", "signature", "replay protection"]);
    expect(h["signature-input"]).toMatch(/^sig2=\("@authority" "@path"\);created=\d+;keyid="test-kid";alg="ed25519";expires=\d+;nonce="[^"]+";tag="agent-payer-auth"$/);
  });

  it("rejects a request sent to a different path than it was signed for", async () => {
    const h = signRequest(URL_, key, { tag: "agent-payer-auth", now });
    expect((await verify(h, { url: "https://checkout.parcelwise.example/api/refund" })).checks.at(-1)).toMatchObject({ name: "signature", pass: false });
  });

  it("rejects a replay of the same signed request", async () => {
    const seen = new Set<string>();
    const h = signRequest(URL_, key, { tag: "agent-payer-auth", now });
    expect((await verify(h, { seen })).ok).toBe(true);
    expect((await verify(h, { seen })).checks.at(-1)).toMatchObject({ name: "replay protection", pass: false });
  });

  it("rejects expired signatures and windows longer than 8 minutes", async () => {
    const h = signRequest(URL_, key, { tag: "agent-payer-auth", now });
    expect((await verify(h, { at: now + 9 * 60_000 })).checks.at(-1)?.name).toBe("time window");
    const long = signRequest(URL_, key, { tag: "agent-payer-auth", now, ttlSeconds: 600 });
    expect((await verify(long)).checks.at(-1)?.name).toBe("time window");
  });

  it("rejects an unknown key and a non-TAP tag", async () => {
    const h = signRequest(URL_, key, { tag: "agent-payer-auth", now });
    expect((await verify(h, { keyFor: "other" })).checks.at(-1)?.name).toBe("key lookup");
    const bot = { ...h, "signature-input": h["signature-input"].replace("agent-payer-auth", "web-bot-auth") };
    expect((await verify(bot)).checks.at(-1)?.name).toBe("trusted agent tag");
  });

  it("signs body objects with the same key and detects tampering", () => {
    const signed = signObject({ nonce: "n1", kid: "test-kid", alg: "ed25519", cardMetadata: { lastFour: "0008" } }, privateKey);
    expect(verifyObject(signed, publicKey)).toBe(true);
    expect(verifyObject({ ...signed, cardMetadata: { lastFour: "1111" } }, publicKey)).toBe(false);
  });
});

describe("Airwallex remote authorization signature", () => {
  const secret = "shared-secret-for-tests";
  const nonce = `${now}.abc123`;
  const signature = createHmac("sha256", secret).update(nonce).digest("base64");
  it("accepts a valid signature and rejects a wrong or stale one", () => {
    expect(verifyRemoteAuthSignature({ nonce, signature, secret, now })).toBe(true);
    expect(verifyRemoteAuthSignature({ nonce, signature: "x" + signature.slice(1), secret, now })).toBe(false);
    expect(verifyRemoteAuthSignature({ nonce, signature, secret, now: now + 10 * 60_000 })).toBe(false);
  });
});

describe("agent checkout: TAP intent, VIC mandate, issuer-side decision", () => {
  let db: Db;
  let issuer: FakeIssuer;
  let purchases: PurchaseDeps;
  let purchaseId: string;
  let vic: StandInVicClient;
  const extracted = [
    { label: "Monthly plan", billing: "monthly" as const, chargeAmount: 480, currency: "USD", commitmentMonths: 1, cancellable: true, quote: "Monthly plan: $480 per month, cancel anytime." },
    { label: "Annual plan", billing: "annual" as const, chargeAmount: 4723.2, currency: "USD", commitmentMonths: 12, cancellable: false, quote: "Annual plan: $4,723.20 per year" },
  ];

  beforeEach(async () => {
    db = await testDb();
    await ensureTenant(db, { id: "platform", kind: "platform", name: "Meridian Market" });
    await seedDemo(db);
    issuer = new FakeIssuer();
    purchases = { db, model: new FakeModel("approve", extracted), issuer, simulator: issuer, sleep: async () => {} };
    vic = new StandInVicClient();
    const row = await submitPurchase(purchases, { tenantId: "seller_lumen", requester: "Maya Chen", vendor: "Parcelwise", merchantCategoryCode: "5734", purpose: "Shipping label software to cut fulfilment time for marketplace orders", termsText: PARCELWISE_TERMS, currency: "USD" });
    purchaseId = row.id;
  });

  const run = (mode: "honest" | "replay" | "forged" | "renewal" | "overcharge") => agentCheckout({ purchases, vic, remoteAuthLive: false }, purchaseId, mode);

  it("an honest checkout is verified by the merchant, authorized against the mandate, and charged", async () => {
    const r = await run("honest");
    expect(r.merchantStatus).toBe(200);
    expect(r.merchantChecks.every((c) => c.pass)).toBe(true);
    expect(r.authorization).toMatchObject({ status: "AUTHORIZED" });
    expect(r.charge).toEqual({ outcome: "accepted", failureReason: null });
    expect(vic.confirmations.at(-1)?.status).toBe("APPROVED");
    const [ins] = await db.query<{ mandate: { purchaseType: string; declineThreshold: { amount: number } } }>("SELECT mandate FROM vic_instructions");
    expect(ins.mandate).toMatchObject({ purchaseType: "PURCHASE_RECURRING", declineThreshold: { amount: 1440 } });
  });

  it("a replayed request is rejected by the merchant and never charged", async () => {
    const r = await run("replay");
    expect(r.merchantStatus).toBe(401);
    expect(r.merchantChecks.at(-1)).toMatchObject({ name: "replay protection", pass: false });
    expect(r.charge).toBeNull();
  });

  it("a forged signature is rejected and never charged", async () => {
    const r = await run("forged");
    expect(r.merchantStatus).toBe(401);
    expect(r.merchantChecks.find((c) => !c.pass)?.name).toBe("signature");
    expect(r.charge).toBeNull();
  });

  it("a first charge with no signed checkout is declined by Treza before the card is touched", async () => {
    const r = await run("renewal");
    expect(r.authorization).toMatchObject({ status: "DECLINED", reason: "No verified agent intent for this charge" });
    expect(r.charge).toBeNull();
  });

  it("after a signed checkout, next month's charge passes and the annual price is declined", async () => {
    await run("honest");
    expect((await run("renewal")).authorization).toMatchObject({ status: "AUTHORIZED" });
    const over = await run("overcharge");
    expect(over.authorization).toMatchObject({ status: "DECLINED", reason: "Above the mandate's per-charge limit" });
    expect(over.charge).toBeNull();
  });

  it("covers later monthly charges under the mandate, and stops at the mandate total", async () => {
    await run("honest");
    const [card] = await db.query<{ airwallex_card_id: string }>("SELECT airwallex_card_id FROM cards");
    const monthly = async (event: string) => {
      const p = { card_id: card.airwallex_card_id, card_transaction_event_id: event, transaction_amount: 480, transaction_currency: "USD", merchant: { category_code: "5734" } };
      const a = await decideAuthorization(db, p);
      await recordAuthorization(db, p, a, 1);
      return a;
    };
    expect((await monthly("m2")).response_status).toBe("AUTHORIZED");
    expect((await monthly("m3")).response_status).toBe("AUTHORIZED");
    expect(await monthly("m4")).toMatchObject({ response_status: "DECLINED", status_reason: "Mandate total would be exceeded" });
  });

  it("declines a different merchant category and a restricted seller", async () => {
    await run("honest");
    const [card] = await db.query<{ airwallex_card_id: string }>("SELECT airwallex_card_id FROM cards");
    const base = { card_id: card.airwallex_card_id, transaction_amount: 40, transaction_currency: "USD" };
    expect((await decideAuthorization(db, { ...base, card_transaction_event_id: "r1", merchant: { category_code: "5812" } })).status_reason).toBe("Merchant category outside the mandate");
    await db.query("UPDATE tenant_risk SET tier = 'restricted' WHERE tenant_id = 'seller_lumen'");
    expect((await decideAuthorization(db, { ...base, card_transaction_event_id: "r2", merchant: { category_code: "5734" } })).status_reason).toBe("Tenant is restricted");
  });
});
