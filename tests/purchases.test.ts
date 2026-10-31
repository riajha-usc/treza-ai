import { beforeEach, describe, expect, it } from "vitest";
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

