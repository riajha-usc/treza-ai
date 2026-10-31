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

describe("evidence integrity", () => {
  it("drops a fact whose quote is not in the cited document", async () => {
    const madeUp = { code: "refund_issued" as const, source: "doc_1103_support", quote: "We issued your refund on Oct 20" };
    await stageDemoDisputes(deps(new FakeDisputeModel([madeUp])));
    const refund = await byOrder("ord_1103");
    expect(refund.decision.facts.some((f) => f.code === "refund_issued")).toBe(false);
    expect(refund.decision.rejectedFacts).toEqual([{ code: "refund_issued", reason: "quote not found in the cited document" }]);
  });

  it("after the issuer rejects, asks the seller for more and sends only new evidence", async () => {
    await stageDemoDisputes(deps());
    const fraud = await byOrder("ord_1042");
    await simulateIssuerRejection(deps(), fraud.id);
    const after = await byOrder("ord_1042");
    expect(after.stage).toBe("CHARGEBACK");
    expect(after.decision.sellerEvidenceRequested).toEqual(["doc_1042_chat"]);
    expect(after.decision.evidenceDocIds).toEqual(["doc_1042_chat"]);
    const subs = await db.query<{ document_ids: string[]; evidence_hash: string }>(
      "SELECT document_ids, evidence_hash FROM dispute_submissions WHERE dispute_id = $1 ORDER BY created_at",
      [fraud.id],
    );
    expect(subs).toHaveLength(2);
    expect(subs[0].evidence_hash).not.toBe(subs[1].evidence_hash);
    expect(subs[0].document_ids).not.toContain("doc_1042_chat");
  });

  it("never resends old evidence: with nothing new, a large case goes to a person", async () => {
    await stageDemoDisputes(deps());
    await db.query("DELETE FROM order_documents WHERE id = 'doc_1042_chat'");
    const fraud = await byOrder("ord_1042");
    await simulateIssuerRejection(deps(), fraud.id);
    const after = await byOrder("ord_1042");
    expect(after.decision.action).toBe("escalate");
    expect(after.decision.reasons[0]).toMatch(/no new evidence/);
    expect(aw.challenges).toHaveLength(1);
  });

  it("without a model, still wins on structured records but sends unread documents to a person", async () => {
    await stageDemoDisputes(deps(null));
    expect((await byOrder("ord_1042")).decision.action).toBe("challenge");
    expect((await byOrder("ord_1077")).decision.action).toBe("escalate");
  });
});

describe("closed loop", () => {
  it("raises seller risk on each dispute, which then tightens that seller's purchases", async () => {
    await stageDemoDisputes(deps());
    expect((await loadRiskTier(db, "seller_harbor")).tier).toBe("elevated");
    const kestrel = await loadRiskTier(db, "seller_kestrel");
    expect(kestrel.tier).toBe("high");
    expect(kestrel.reasons.at(-1)).toMatch(/13\.6/);

    const row = await submitPurchase(
      { db, model: null, issuer: null, simulator: null },
      { tenantId: "seller_kestrel", requester: "Ava", vendor: "Parcelwise", merchantCategoryCode: "5734", purpose: "Shipping label software for marketplace orders", termsText: PARCELWISE_TERMS, currency: "USD" },
    );
    expect(row.status).toBe("pending_approval");
    expect(row.decision.rules?.results.find((r) => r.code === "tenant_risk")?.detail).toMatch(/high/);
  });

  it("counts each dispute toward risk only once, however often it syncs", async () => {
    await stageDemoDisputes(deps());
    const before = await loadRiskTier(db, "seller_harbor");
    await processDisputes(deps());
    await processDisputes(deps());
    expect((await loadRiskTier(db, "seller_harbor")).reasons).toEqual(before.reasons);
    expect((await getDispute(db, (await byOrder("ord_1042")).id)).status).toBe("CHALLENGED");
  });
});
