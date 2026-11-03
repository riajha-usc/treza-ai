import { beforeEach, describe, expect, it } from "vitest";
import { ApprovalError } from "@/lib/approvals/approvals";
import { PURCHASE_APPROVAL_HOURS, sweepExpiredApprovals } from "@/lib/approvals/sweep";
import { listAudit } from "@/lib/audit/audit";
import { testDb, type Db } from "@/lib/db/client";
import { ensureTenant } from "@/lib/ledger/ledger";
import { getPurchase, resolvePurchase, setCardFrozen, simulateCharge, submitPurchase, type PurchaseDeps } from "@/lib/purchases/agent";
import { loadCash } from "@/lib/purchases/cash";
import { buildCardControls } from "@/lib/purchases/controls";
import { loadPolicy, loadRiskTier } from "@/lib/purchases/policy";
import { evaluateRules } from "@/lib/purchases/rules";
import { parseTermsWithRules, verifyExtracted } from "@/lib/purchases/terms";
import { PARCELWISE_TERMS, seedDemo } from "@/lib/seed";
import { FakeIssuer, FakeModel } from "./fakes";

let db: Db;
let issuer: FakeIssuer;

beforeEach(async () => {
  db = await testDb();
  await ensureTenant(db, { id: "platform", kind: "platform", name: "Meridian Market" });
  await seedDemo(db);
  issuer = new FakeIssuer();
});

const deps = (model: FakeModel | null): PurchaseDeps => ({ db, model, issuer, simulator: issuer, sleep: async () => {} });

const parcelwise = {
  tenantId: "seller_lumen",
  requester: "Maya Chen",
  vendor: "Parcelwise",
  merchantCategoryCode: "5734",
  purpose: "Shipping label software to cut fulfilment time for marketplace orders",
  termsText: PARCELWISE_TERMS,
  currency: "USD",
};

const extractedCorrectly = [
  { label: "Monthly plan", billing: "monthly" as const, chargeAmount: 480, currency: "USD", commitmentMonths: 1, cancellable: true, quote: "Monthly plan: $480 per month, cancel anytime." },
  { label: "Annual plan", billing: "annual" as const, chargeAmount: 4723.2, currency: "USD", commitmentMonths: 12, cancellable: false, quote: "Annual plan: $4,723.20 per year" },
];

describe("Kit 02 scenario: annual is cheaper but breaks the reserve in week 7", () => {
  it("chooses monthly and records annual as deferred", async () => {
    const policy = (await loadPolicy(db, "seller_lumen"))!;
    const { options } = verifyExtracted(PARCELWISE_TERMS, parseTermsWithRules(PARCELWISE_TERMS, "USD"));
    const out = evaluateRules({
      vendor: "Parcelwise",
      merchantCategoryCode: "5734",
      purpose: parcelwise.purpose,
      options,
      policy,
      risk: await loadRiskTier(db, "seller_lumen"),
      cash: await loadCash(db, "seller_lumen", "USD"),
      activeVendors: [],
    });
    expect(out.chosen?.billing).toBe("monthly");
    expect(out.deferred).toHaveLength(1);
    expect(out.deferred[0]).toMatchObject({ firstBreachWeek: 7 });
    expect(out.projections.find((p) => p.optionId.includes("monthly"))!.firstBreachWeek).toBeNull();
    // $480 is above the $250 auto-approval limit, so the model is consulted, but no person is needed.
    expect(out.verdict).toBe("review");
    expect(out.needsHuman).toBe(false);
  });

  it("builds card controls that make the annual price impossible to charge", () => {
    const c = buildCardControls({
      option: { id: "m", label: "Monthly", billing: "monthly", chargeMinor: 48_000, currency: "USD", commitmentMonths: 1, cancellable: true },
      merchantCategoryCode: "5734",
      reconsiderAfterDays: 90,
      now: new Date("2026-10-31T00:00:00Z"),
    });
    expect(c.allowed_transaction_count).toBe("MULTIPLE");
    expect(c.transaction_limits.limits).toEqual([
      { amount: 480, interval: "PER_TRANSACTION" },
      { amount: 480, interval: "MONTHLY" },
      { amount: 1440, interval: "ALL_TIME" },
    ]);
    expect(c.allowed_merchant_categories).toEqual(["5734"]);
    expect(c.active_to).toBe("2027-01-29T00:00:00.000Z");
  });
});

describe("reading vendor terms", () => {
  it("parses common price phrasings without a model", () => {
    const parsed = parseTermsWithRules(PARCELWISE_TERMS, "USD");
    expect(parsed.map((p) => [p.billing, p.chargeAmount])).toEqual([
      ["monthly", 480],
      ["annual", 4723.2],
    ]);
  });

  it("rejects a price the terms do not contain, even if a model claims it", () => {
    const { options, rejected } = verifyExtracted(PARCELWISE_TERMS, [
      ...extractedCorrectly,
      { label: "Lifetime deal", billing: "one_time", chargeAmount: 99, currency: "USD", commitmentMonths: 0, cancellable: false, quote: "Lifetime access for $99 one-time" },
      { label: "Monthly misread", billing: "monthly", chargeAmount: 48, currency: "USD", commitmentMonths: 1, cancellable: true, quote: "Monthly plan: $480 per month, cancel anytime." },
    ]);
    expect(options).toHaveLength(2);
    expect(rejected.map((r) => r.reason)).toEqual([
      "quote does not appear in the vendor terms",
      "price is not stated in the quoted text",
    ]);
  });
});

describe("purchase agent", () => {
  it("runs the full Kit 02 flow: read terms, rules, model, card, then the card enforces the decision", async () => {
    const model = new FakeModel("approve", extractedCorrectly);
    const row = await submitPurchase(deps(model), parcelwise);
    expect(row.status).toBe("card_issued");
    expect(row.decision.chosen?.billing).toBe("monthly");
    expect(row.decision.extraction?.source).toBe("claude");
    expect(model.assessCalls).toBe(1);

    const [card] = await db.query<{ id: string }>("SELECT id FROM cards WHERE purchase_request_id = $1", [row.id]);
    const monthly = await simulateCharge(deps(model), card.id, { amountMinor: 48_000, currency: "USD", merchantCategoryCode: "5734", label: "Parcelwise" });
    const annual = await simulateCharge(deps(model), card.id, { amountMinor: 472_320, currency: "USD", merchantCategoryCode: "5734", label: "Parcelwise annual" });
    const wrongMerchant = await simulateCharge(deps(model), card.id, { amountMinor: 4_000, currency: "USD", merchantCategoryCode: "5812", label: "Restaurant" });
    expect(monthly.outcome).toBe("accepted");
    expect(annual).toEqual({ outcome: "declined", failureReason: "LIMIT_EXCEEDED" });
    expect(wrongMerchant).toEqual({ outcome: "declined", failureReason: "MERCHANT_CATEGORY_NOT_ALLOWED" });

    const actions = (await listAudit(db, { subjectId: row.id })).map((a) => a.action).reverse();
    expect(actions).toEqual(["purchase.received", "purchase.terms_read", "purchase.rules_review", "purchase.assessed", "card.issued"]);
  });

  it("denies a blocked merchant category without ever asking the model", async () => {
    const model = new FakeModel("approve");
    const row = await submitPurchase(deps(model), { ...parcelwise, merchantCategoryCode: "7995", vendor: "LuckySpin" });
    expect(row.status).toBe("denied");
    expect(model.assessCalls).toBe(0);
    expect(issuer.calls.filter((c) => c.method === "createCard")).toHaveLength(0);
  });

  it("falls back to rules and a person when no model is configured", async () => {
    const row = await submitPurchase(deps(null), parcelwise);
    expect(row.decision.extraction?.source).toBe("rules");
    expect(row.status).toBe("pending_approval");
    const done = await resolvePurchase(deps(null), row.approval_id!, { decision: "approved", by: "ria" });
    expect(done.status).toBe("card_issued");
  });

  it("escalates to a person when the model refuses", async () => {
    const row = await submitPurchase(deps(new FakeModel("refuse", extractedCorrectly)), parcelwise);
    expect(row.status).toBe("pending_approval");
    expect(row.decision.assessmentIssue).toMatch(/refused/);
  });

  it("refuses to issue if the approved terms were changed after approval", async () => {
    const row = await submitPurchase(deps(null), parcelwise);
    const tampered = { ...row.decision, controls: { ...row.decision.controls!, allowed_merchant_categories: ["7995"] } };
    await db.query("UPDATE purchase_requests SET decision = $2 WHERE id = $1", [row.id, JSON.stringify(tampered)]);
    const done = await resolvePurchase(deps(null), row.approval_id!, { decision: "approved", by: "ria" });
    expect(done.status).toBe("denied");
    expect(done.decision.summary).toMatch(/terms changed/);
    expect(issuer.calls.filter((c) => c.method === "createCard")).toHaveLength(0);
  });

  it("closed loop: a risk change between approval and issuance blocks the card", async () => {
    const row = await submitPurchase(deps(null), parcelwise);
    await db.query("UPDATE tenant_risk SET tier = 'restricted', reasons = $2 WHERE tenant_id = $1", [
      "seller_lumen",
      JSON.stringify(["Chargeback opened on order 1042"]),
    ]);
    const done = await resolvePurchase(deps(null), row.approval_id!, { decision: "approved", by: "ria" });
    expect(done.status).toBe("denied");
    expect(done.decision.summary).toMatch(/conditions changed/);
  });

  it("issues a tenant's card on behalf of its connected account (Kit 05)", async () => {
    await ensureTenant(db, { id: "seller_lumen", kind: "seller", name: "Lumen Home Goods", airwallexAccountId: "acct_lumen" });
    await submitPurchase(deps(new FakeModel("approve", extractedCorrectly)), parcelwise);
    expect(issuer.calls.find((c) => c.method === "createCard")?.onBehalfOf).toBe("acct_lumen");
  });

  it("lets the agent freeze its own card, after which charges decline", async () => {
    const row = await submitPurchase(deps(new FakeModel("approve", extractedCorrectly)), parcelwise);
    const [card] = await db.query<{ id: string }>("SELECT id FROM cards WHERE purchase_request_id = $1", [row.id]);
    await setCardFrozen(deps(null), card.id, true, { actor: "system", reason: "Unexpected merchant" });
    const res = await simulateCharge(deps(null), card.id, { amountMinor: 48_000, currency: "USD", merchantCategoryCode: "5734", label: "Parcelwise" });
    expect(res).toEqual({ outcome: "declined", failureReason: "CARD_INACTIVE" });
  });

  it("reuses an existing cardholder and retries a failed issuance", async () => {
    const { AirwallexError } = await import("@/lib/airwallex/client");
    let first = true;
    const original = issuer.createCardholder.bind(issuer);
    issuer.createCardholder = async (input) => {
      if (first) {
        first = false;
        throw new AirwallexError(400, "bad_request", "The given email or mobile number is already associated with a cardholder.");
      }
      return original(input);
    };
    const row = await submitPurchase(deps(new FakeModel("approve", extractedCorrectly)), parcelwise);
    expect(row.status).toBe("card_issued");
    const [holder] = await db.query<{ airwallex_cardholder_id: string }>("SELECT airwallex_cardholder_id FROM cardholders");
    expect(holder.airwallex_cardholder_id).toBe("ch_existing");
  });

  it("never issues a second card for the same purchase", async () => {
    const row = await submitPurchase(deps(new FakeModel("approve", extractedCorrectly)), parcelwise);
    expect((await getPurchase(db, row.id)).status).toBe("card_issued");
    const creates = issuer.calls.filter((c) => c.method === "createCard");
    expect(creates).toHaveLength(1);
    const [stored] = await db.query<{ request_id: string }>("SELECT request_id FROM outbound_requests WHERE op_key = $1", [`card:${row.id}`]);
    expect(creates[0].requestId).toBe(stored.request_id);
  });
});

describe("approval controls", () => {
  it("the requester cannot approve their own purchase", async () => {
    const row = await submitPurchase(deps(null), parcelwise);
    expect(row.status).toBe("pending_approval");
    await expect(resolvePurchase(deps(null), row.approval_id!, { decision: "approved", by: "Maya Chen" })).rejects.toBeInstanceOf(ApprovalError);
    expect((await getPurchase(db, row.id)).status).toBe("pending_approval");
    expect(issuer.calls.filter((c) => c.method === "createCard")).toHaveLength(0);
  });

  it("an approval nobody acts on lapses, denies the purchase and never issues a card", async () => {
    const row = await submitPurchase(deps(null), parcelwise);
    const afterWindow = new Date(Date.now() + (PURCHASE_APPROVAL_HOURS + 1) * 3_600_000);
    expect((await sweepExpiredApprovals(db, afterWindow)).map((a) => a.subject_id)).toEqual([row.id]);
    const denied = await getPurchase(db, row.id);
    expect(denied.status).toBe("denied");
    expect(denied.decision.summary).toMatch(/expired/);
    await expect(resolvePurchase(deps(null), row.approval_id!, { decision: "approved", by: "Priya Shah" })).rejects.toBeInstanceOf(ApprovalError);
    expect(issuer.calls.filter((c) => c.method === "createCard")).toHaveLength(0);
  });
});
