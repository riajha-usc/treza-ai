import { beforeEach, describe, expect, it } from "vitest";
import { testDb, type Db } from "@/lib/db/client";
import { PLATFORM_ACCOUNTS } from "@/lib/ledger/accounts";
import { accountBalance, ensureTenant } from "@/lib/ledger/ledger";
import { loadRiskTier } from "@/lib/purchases/policy";
import { seedDemo } from "@/lib/seed";
import { decideBridges, repayBridges, requestBridge } from "@/lib/settlement/bridging";
import { runSettlementCycle } from "@/lib/settlement/cycle";
import { sellerPosition, type SettlementDeps } from "@/lib/settlement/deps";
import { DEMO_BRIDGE_REQUESTS, DEMO_CARRIER_FAILURE, DEMO_CYCLE_SALES, seedSellerMetrics } from "@/lib/settlement/demo";
import { reportCarrierFailure } from "@/lib/settlement/exposure";
import { onboardSellers, SELLER_PROFILES } from "@/lib/settlement/onboard";
import { reconcileCycle } from "@/lib/settlement/reconcile";
import { computeReserve } from "@/lib/settlement/reserves";
import { FakePlatform } from "./settlement-fakes";

// Placeholder text only. The fake platform never sends these anywhere.
const TEST_IDENTITIES = Object.fromEntries(
  ["seller_lumen", "seller_harbor", "seller_kestrel"].map((id) => [id, { ein: "test-ein", person: { identificationType: "PASSPORT" as const, number: "test-id", issuingCountry: "US" } }]),
);

let db: Db;
let aw: FakePlatform;
let deps: SettlementDeps;

beforeEach(async () => {
  db = await testDb();
  await ensureTenant(db, { id: "platform", kind: "platform", name: "Meridian Market" });
  await seedDemo(db);
  await seedSellerMetrics(db);
  aw = new FakePlatform();
  deps = { db, gateway: aw, simulator: aw, sleep: async () => {} };
});

const line = async (tenantId: string) =>
  (await db.query<{ reserve_rate_bps: number; reserve_target_minor: number; payout_minor: number; explanation: string[] }>(
    "SELECT * FROM settlement_lines WHERE tenant_id = $1 ORDER BY cycle_id DESC LIMIT 1",
    [tenantId],
  ))[0];

describe("reserve policy", () => {
  it("explains every term and gives the newest, riskiest seller the highest rate", () => {
    const base = { currency: "USD", grossMinor: 320_000, openDisputesMinor: 0, exposureMinor: 0 };
    const newest = computeReserve({ ...base, trailingRefundRateBps: 800, accountAgeDays: 38, riskTier: "elevated" });
    const steady = computeReserve({ ...base, trailingRefundRateBps: 100, accountAgeDays: 800, riskTier: "low" });
    expect(newest.rateBps).toBe(3_500);
    expect(steady.rateBps).toBe(250);
    expect(newest.explanation).toEqual(expect.arrayContaining([expect.stringMatching(/New seller \(38 days\)/), expect.stringMatching(/Risk tier elevated/)]));
  });

  it("holds the whole cycle for a restricted seller", () => {
    const r = computeReserve({ currency: "USD", grossMinor: 100_000, trailingRefundRateBps: 100, accountAgeDays: 500, riskTier: "restricted", openDisputesMinor: 0, exposureMinor: 0 });
    expect(r.targetMinor).toBe(100_000);
  });
});

describe("Kit 08: settle sellers", () => {
  beforeEach(async () => {
    await onboardSellers(deps, TEST_IDENTITIES);
  });

  it("skips onboarding when no identities file has been filled in", async () => {
    const fresh: SettlementDeps = { db: await testDb(), gateway: new FakePlatform(), simulator: null, sleep: async () => {} };
    fresh.simulator = fresh.gateway as FakePlatform;
    expect((await onboardSellers(fresh, null)).every((l) => l.includes("skipped"))).toBe(true);
  });

  it("reuses a connected account an earlier run left unsubmitted instead of creating a second one", async () => {
    const platform = new FakePlatform();
    const fresh: SettlementDeps = { db: await testDb(), gateway: platform, simulator: platform, sleep: async () => {} };
    await ensureTenant(fresh.db, { id: "platform", kind: "platform", name: "Meridian Market" });
    await seedDemo(fresh.db);
    await seedSellerMetrics(fresh.db);
    const [profile] = SELLER_PROFILES;
    await platform.createAccount({ ...profile, identity: TEST_IDENTITIES[profile.tenantId] });
    const log = await onboardSellers(fresh, TEST_IDENTITIES);
    expect(log.some((l) => l.includes("from an earlier run"))).toBe(true);
    const lumen = [...platform.accounts.values()].filter((a) => a.profile.tenantId === "seller_lumen");
    expect(lumen).toHaveLength(1);
    expect(lumen[0].status).toBe("ACTIVE");
  });

  it("onboards each seller once as an active connected account with its own Global Account", async () => {
    await onboardSellers(deps, TEST_IDENTITIES);
    expect(aw.accounts.size).toBe(3);
    expect([...aw.accounts.values()].every((a) => a.status === "ACTIVE")).toBe(true);
    const [{ n }] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM seller_metrics WHERE airwallex_global_account_id IS NOT NULL");
    expect(n).toBe(3);
  });

  it("pays every seller its net minus a reserve set from its own risk, exactly once", async () => {
    await runSettlementCycle(deps, "cycle_1", DEMO_CYCLE_SALES);
    await runSettlementCycle(deps, "cycle_1", DEMO_CYCLE_SALES);
    const lumen = await line("seller_lumen");
    const kestrel = await line("seller_kestrel");
    // Lumen: 6,400 gross, 640 fee, 160 refunds, 6.25% reserve (400) = 5,200 paid.
    expect(lumen.payout_minor).toBe(520_000);
    expect(kestrel.reserve_rate_bps).toBeGreaterThan(lumen.reserve_rate_bps);
    expect(aw.transfers).toHaveLength(3);
    for (const s of ["seller_lumen", "seller_harbor", "seller_kestrel"]) expect((await sellerPosition(db, s)).payableMinor).toBe(0);
  });

  it("reconciles: the platform wallet moved exactly what the ledger says", async () => {
    await runSettlementCycle(deps, "cycle_1", DEMO_CYCLE_SALES);
    const r = await reconcileCycle(deps, "cycle_1");
    expect(r.ok).toBe(true);
    expect(r.findings.at(-1)).toMatch(/matching the ledger exactly/);
    // What the platform keeps equals its fees plus the reserves it holds.
    const fees = await accountBalance(db, "platform", PLATFORM_ACCOUNTS.revenue, "USD");
    const reserves = (await sellerPosition(db, "seller_lumen")).reserveMinor + (await sellerPosition(db, "seller_harbor")).reserveMinor + (await sellerPosition(db, "seller_kestrel")).reserveMinor;
    expect(await accountBalance(db, "platform", PLATFORM_ACCOUNTS.cash, "USD")).toBe(fees + reserves);
  });

  it("carrier failure: recalculates only the affected seller and charges the shortfall after checking its wallet", async () => {
    await runSettlementCycle(deps, "cycle_1", DEMO_CYCLE_SALES);
    const harborBefore = await sellerPosition(db, "seller_harbor");
    const kestrelBefore = await sellerPosition(db, "seller_kestrel");
    const res = await reportCarrierFailure(deps, DEMO_CARRIER_FAILURE);
    expect(res.shortfallMinor).toBeGreaterThan(0);
    expect(res.chargedMinor).toBe(res.shortfallMinor);
    expect(aw.charges).toHaveLength(1);
    expect((await sellerPosition(db, "seller_lumen")).reserveMinor).toBe(res.targetMinor);
    expect(await sellerPosition(db, "seller_harbor")).toEqual(harborBefore);
    expect(await sellerPosition(db, "seller_kestrel")).toEqual(kestrelBefore);
    expect((await loadRiskTier(db, "seller_lumen")).tier).toBe("elevated");
    expect((await reconcileCycle(deps, "cycle_1")).ok).toBe(true);
  });

  it("records what a short wallet cannot cover and nets it from the next payout", async () => {
    await runSettlementCycle(deps, "cycle_1", DEMO_CYCLE_SALES);
    const lumenAcct = [...aw.accounts.entries()].find(([, a]) => a.profile.tenantId === "seller_lumen")![0];
    aw.wallets.set(lumenAcct, 50_000);
    const res = await reportCarrierFailure(deps, DEMO_CARRIER_FAILURE);
    expect(res.chargedMinor).toBe(50_000);
    expect(res.owedMinor).toBe(res.shortfallMinor - 50_000);
    await runSettlementCycle(deps, "cycle_2", DEMO_CYCLE_SALES);
    expect((await sellerPosition(db, "seller_lumen")).receivableMinor).toBe(0);
    expect((await line("seller_lumen")).explanation.join(" ")).toMatch(/Netted/);
  });
});

describe("Kit 05: bridge late deposits with scarce capital", () => {
  beforeEach(async () => {
    await onboardSellers(deps, TEST_IDENTITIES);
    await runSettlementCycle(deps, "cycle_1", DEMO_CYCLE_SALES);
    // Give the platform enough unreserved cash that the facility, not cash, binds.
    await db.query("UPDATE tenant_risk SET tier = 'high' WHERE tenant_id = 'seller_kestrel'");
    const { postEntry } = await import("@/lib/ledger/ledger");
    await postEntry(db, {
      idempotencyKey: "test:funding",
      kind: "funding",
      description: "Platform capital",
      lines: [
        { tenantId: "platform", account: PLATFORM_ACCOUNTS.cash, amountMinor: 1_000_000, currency: "USD" },
        { tenantId: "platform", account: PLATFORM_ACCOUNTS.funding, amountMinor: -1_000_000, currency: "USD" },
      ],
    });
  });

  it("funds one, defers another for lack of capital, and refuses a high-risk seller", async () => {
    for (const r of DEMO_BRIDGE_REQUESTS) await requestBridge(deps, r);
    await decideBridges(deps);
    const rows = await db.query<{ tenant_id: string; status: string }>("SELECT tenant_id, status FROM bridges ORDER BY tenant_id");
    expect(Object.fromEntries(rows.map((r) => [r.tenant_id, r.status]))).toEqual({ seller_harbor: "deferred", seller_kestrel: "denied", seller_lumen: "funded" });
  });

  it("never lends against seller reserves: the reserve floor binds first", async () => {
    await db.query("DELETE FROM bridges");
    const { postEntry } = await import("@/lib/ledger/ledger");
    await postEntry(db, {
      idempotencyKey: "test:withdraw",
      kind: "funding",
      description: "Remove the extra capital",
      lines: [
        { tenantId: "platform", account: PLATFORM_ACCOUNTS.funding, amountMinor: 1_000_000, currency: "USD" },
        { tenantId: "platform", account: PLATFORM_ACCOUNTS.cash, amountMinor: -1_000_000, currency: "USD" },
      ],
    });
    // Unreserved cash is only the platform's fees ($1,940). Ask for more, within the facility.
    await requestBridge(deps, { tenantId: "seller_lumen", amountMinor: 230_000, purpose: "Large supplier invoice" });
    const [log] = await decideBridges(deps, { facilityMinor: 250_000, perSellerCapMinor: 300_000, eligibleTiers: ["low", "elevated"] });
    expect(log).toMatch(/deferred/);
    expect(log).toMatch(/\$1,940\.00 of bridge capital/);
  });

  it("charges the bridge back when the late deposit lands", async () => {
    await requestBridge(deps, DEMO_BRIDGE_REQUESTS[0]);
    await decideBridges(deps);
    await repayBridges(deps, "seller_lumen", 300_000);
    const [b] = await db.query<{ status: string }>("SELECT status FROM bridges");
    expect(b.status).toBe("repaid");
    expect(await accountBalance(db, "platform", PLATFORM_ACCOUNTS.bridgeReceivable, "USD")).toBe(0);
  });
});
