import { beforeEach, describe, expect, it } from "vitest";
import { buildBus, type App } from "@/lib/app";
import { listApprovals } from "@/lib/approvals/approvals";
import { testDb, type Db } from "@/lib/db/client";
import { ensureTenant } from "@/lib/ledger/ledger";
import { resolvePurchase } from "@/lib/purchases/agent";
import { loadRiskTier } from "@/lib/purchases/policy";
import { seedDemo } from "@/lib/seed";
import { seedSellerMetrics } from "@/lib/settlement/demo";
import { onboardSellers } from "@/lib/settlement/onboard";
import { advanceStory, loadStory, startStory, STORY_STEPS, STORY_TENANT } from "@/lib/story/story";
import { StandInVicClient } from "@/lib/visa/vic";
import { FakeDisputeModel, FakeDisputes } from "./dispute-fakes";
import { FakeIssuer, FakeModel } from "./fakes";
import { FakePlatform } from "./settlement-fakes";

// Placeholder text only. The fake platform never sends these anywhere.
const TEST_IDENTITIES = Object.fromEntries(
  ["seller_lumen", "seller_harbor", "seller_kestrel"].map((id) => [id, { ein: "test-ein", person: { identificationType: "PASSPORT" as const, number: "test-id", issuingCountry: "US" } }]),
);

let db: Db;
let app: App;

beforeEach(async () => {
  db = await testDb();
  await ensureTenant(db, { id: "platform", kind: "platform", name: "Meridian Market" });
  await seedDemo(db);
  await seedSellerMetrics(db);
  const issuer = new FakeIssuer();
  const platform = new FakePlatform();
  const disputesGw = new FakeDisputes();
  const disputes = { db, gateway: disputesGw, simulator: disputesGw, model: new FakeDisputeModel() };
  app = {
    db,
    bus: buildBus(disputes),
    airwallex: null,
    purchases: { db, model: new FakeModel("approve"), issuer, simulator: issuer, sleep: async () => {} },
    disputes,
    settlement: { db, gateway: platform, simulator: platform, sleep: async () => {} },
    visa: { vic: new StandInVicClient(), remoteAuthLive: false },
  };
});

async function playThrough(runId: string) {
  for (let i = 0; i < STORY_STEPS.length + 1; i++) {
    const r = await advanceStory(app, runId);
    if (!r.more) return r;
  }
  throw new Error("The story did not finish");
}

const count = async (sql: string) => Number((await db.query<{ n: number }>(sql))[0].n);

describe("Run the story", () => {
  it("plays Lumen's journey end to end against the fakes and closes the loop", async () => {
    await onboardSellers(app.settlement, TEST_IDENTITIES);
    const runId = await startStory(db, "Priya Shah");
    const last = await playThrough(runId);
    expect(last.status).toBe("done");

    const { run, steps } = await loadStory(db);
    expect(run?.id).toBe(runId);
    expect(run?.status).toBe("done");
    const byId = Object.fromEntries(steps.map((s) => [s.id, s.row!]));
    expect(steps.map((s) => s.row!.status)).not.toContain("failed");
    expect(byId.purchase.narration).toContain("week 7");
    expect(byId.purchase.refs.card).toBeTruthy();
    expect(byId.checkout.narration).toMatch(/verified 9 of 9 checks/);
    expect(byId.checkout.narration).toMatch(/replay protection/);
    expect(byId.card.narration).toContain("refused everything outside the decision");
    expect(byId.settle.status).toBe("done");
    expect(byId.settle.refs.transfer).toBeTruthy();
    expect(byId.carrier.narration).toContain("Risk tier: low to elevated");
    expect((await loadRiskTier(db, STORY_TENANT)).tier).toBe("elevated");
    expect(byId.loop.narration).toContain("That is the loop");
    expect(byId.loop.refs.capAfter).not.toBe(byId.loop.refs.capBefore);
    expect(byId.bridge.narration).toMatch(/funded/);
    expect(byId.deposits.status).toBe("done");
    expect(byId.dispute.narration).toContain("challenge");
    expect(await count("SELECT count(*)::int AS n FROM audit_log WHERE action LIKE 'story.%'")).toBe(STORY_STEPS.length + 1);
  });

  it("reuses the card on a second run and opens a new settlement cycle", async () => {
    await onboardSellers(app.settlement, TEST_IDENTITIES);
    await playThrough(await startStory(db, "Priya Shah"));
    const second = await startStory(db, "Priya Shah");
    await playThrough(second);
    const { steps } = await loadStory(db);
    const byId = Object.fromEntries(steps.map((s) => [s.id, s.row!]));
    expect(byId.purchase.narration).toContain("from an earlier run");
    expect(byId.checkout.narration).toContain("Already done");
    expect(await count("SELECT count(*)::int AS n FROM cards")).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM purchase_requests")).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM settlement_cycles")).toBe(2);
    expect(await count("SELECT count(*)::int AS n FROM story_runs WHERE status = 'done'")).toBe(2);
  });

  it("pauses when the purchase needs a person and resumes after they decide", async () => {
    app.purchases.model = null; // Gray-zone requests go to a person when Claude is not configured.
    const runId = await startStory(db, "Priya Shah");
    const first = await advanceStory(app, runId);
    expect(first).toMatchObject({ step: "purchase", status: "waiting", more: false });
    expect((await loadStory(db)).run?.status).toBe("waiting");

    const [approval] = await listApprovals(db, { status: "pending" });
    await resolvePurchase(app.purchases, approval.id, { decision: "approved", by: "Priya Shah" });
    const again = await advanceStory(app, runId);
    expect(again).toMatchObject({ step: "purchase", status: "done", more: true });
  });

  it("stops on a failed step, keeps the earlier steps, and retries the same step", async () => {
    await onboardSellers(app.settlement, TEST_IDENTITIES);
    const runId = await startStory(db, "Priya Shah");
    await advanceStory(app, runId);
    const platform = app.settlement.gateway as FakePlatform;
    const transfer = platform.transferToSeller.bind(platform);
    platform.transferToSeller = async () => {
      throw new Error("sandbox timeout");
    };
    await advanceStory(app, runId); // checkout
    await advanceStory(app, runId); // card
    const failed = await advanceStory(app, runId); // settle
    expect(failed).toMatchObject({ step: "settle", status: "failed", more: false });
    expect((await loadStory(db)).run?.status).toBe("failed");
    platform.transferToSeller = transfer;
    const retried = await advanceStory(app, runId);
    expect(retried).toMatchObject({ step: "settle", status: "done", more: true });
    expect((await loadStory(db)).steps.filter((s) => s.row!.status === "done")).toHaveLength(4);
  });
});
