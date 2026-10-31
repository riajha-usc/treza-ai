import { beforeEach, describe, expect, it } from "vitest";
import { listApprovals } from "@/lib/approvals/approvals";
import { testDb, type Db } from "@/lib/db/client";
import { getDispute, type DisputeDecision, type DisputeDeps } from "@/lib/disputes/agent";
import { processDisputes, simulateIssuerRejection, stageDemoDisputes } from "@/lib/disputes/pipeline";
import { PLATFORM_ACCOUNTS } from "@/lib/ledger/accounts";
import { accountBalance, ensureTenant } from "@/lib/ledger/ledger";
import { loadRiskTier } from "@/lib/purchases/policy";
import { submitPurchase } from "@/lib/purchases/agent";
import { seedDemo, PARCELWISE_TERMS } from "@/lib/seed";
import { FakeDisputeModel, FakeDisputes } from "./dispute-fakes";

let db: Db;
let aw: FakeDisputes;

beforeEach(async () => {
  db = await testDb();
  await ensureTenant(db, { id: "platform", kind: "platform", name: "Meridian Market" });
  await seedDemo(db);
  aw = new FakeDisputes();
});

const deps = (model: FakeDisputeModel | null = new FakeDisputeModel()): DisputeDeps => ({ db, gateway: aw, simulator: aw, model });

async function byOrder(orderId: string) {
  const [row] = await db.query<{ id: string; status: string; stage: string; decision: DisputeDecision }>(
    "SELECT id, status, stage, decision FROM disputes WHERE order_id = $1",
    [orderId],
  );
  return row;
}

describe("Kit 04: three disputes, three different decisions", () => {
  it("challenges the strong fraud claim, accepts the small one, and escalates the ignored refund", async () => {
    await stageDemoDisputes(deps());
    const fraud = await byOrder("ord_1042");
    const small = await byOrder("ord_1077");
    const refund = await byOrder("ord_1103");

    expect(fraud.decision.action).toBe("challenge");
    expect(fraud.status).toBe("CHALLENGED");
    expect(fraud.decision.facts.map((f) => f.code)).toEqual(
      expect.arrayContaining(["prior_orders_same_device", "prior_orders_same_ip", "delivery_signed"]),
    );
    expect(small.decision.action).toBe("accept");
    expect(small.status).toBe("ACCEPTED");
    expect(refund.decision.action).toBe("escalate");
    expect(refund.decision.reasons[0]).toMatch(/never got a reply/);
    expect((await listApprovals(db, { status: "pending" })).map((a) => a.kind)).toEqual(["dispute"]);
  });

  it("books the challenge fee and the accepted loss in the ledger", async () => {
    await stageDemoDisputes(deps());
    expect(await accountBalance(db, "platform", PLATFORM_ACCOUNTS.disputeFees, "USD")).toBe(2_000);
    expect(await accountBalance(db, "platform", PLATFORM_ACCOUNTS.disputeLosses, "USD")).toBe(1_800);
  });

  it("sends a challenge with an uploaded evidence PDF", async () => {
    await stageDemoDisputes(deps());
    expect(aw.uploads).toBe(1);
    const docs = (aw.challenges[0].body.supporting_documents as { documents: { file_ids: string[] }[] }).documents;
    expect(docs[0].file_ids).toEqual(["file_1"]);
  });
});

