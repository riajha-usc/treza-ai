import { beforeEach, describe, expect, it } from "vitest";
import { listAudit } from "@/lib/audit/audit";
import { ApprovalError, requestApproval, resolveApproval } from "@/lib/approvals/approvals";
import { sweepExpiredApprovals } from "@/lib/approvals/sweep";
import { testDb, type Db } from "@/lib/db/client";
import { EventBus, emit, recordInbound, type EventRow } from "@/lib/events/bus";
import { ensureTenant } from "@/lib/ledger/ledger";

let db: Db;

beforeEach(async () => {
  db = await testDb();
  await ensureTenant(db, { id: "platform", kind: "platform", name: "Platform" });
});

describe("event bus", () => {
  it("drops a redelivered webhook with the same event id", async () => {
    const first = await recordInbound(db, { externalId: "evt_1", type: "deposit.settled", payload: {} });
    const again = await recordInbound(db, { externalId: "evt_1", type: "deposit.settled", payload: {} });
    expect(again).toEqual({ eventId: first.eventId, duplicate: true });
    const [{ n }] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM events");
    expect(n).toBe(1);
  });

  it("processes events in the order they happened, not the order they arrived", async () => {
    const seen: string[] = [];
    const bus = new EventBus().on("t", async (e: EventRow) => void seen.push(e.external_id));
    await recordInbound(db, { externalId: "late", type: "t", payload: {}, occurredAt: "2026-10-26T10:05:00Z" });
    await recordInbound(db, { externalId: "early", type: "t", payload: {}, occurredAt: "2026-10-26T10:00:00Z" });
    await bus.processPending(db);
    expect(seen).toEqual(["early", "late"]);
  });

  it("marks a failing handler as failed, keeps the error, and retries later", async () => {
    let calls = 0;
    const bus = new EventBus().on("t", async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
    });
    await emit(db, { key: "k1", type: "t", payload: {} });
    expect(await bus.processPending(db)).toEqual({ processed: 0, failed: 1 });
    const [failed] = await db.query<EventRow>("SELECT * FROM events");
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("boom");
    expect(await bus.processPending(db)).toEqual({ processed: 1, failed: 0 });
  });

  it("ignores events nobody handles", async () => {
    await emit(db, { key: "k2", type: "unknown.type", payload: {} });
    await new EventBus().processPending(db);
    const [row] = await db.query<EventRow>("SELECT * FROM events");
    expect(row.status).toBe("ignored");
  });
});

describe("approvals", () => {
  const ask = () =>
    requestApproval(db, {
      tenantId: "platform",
      kind: "purchase",
      subjectType: "purchase_request",
      subjectId: "pr_1",
      amountMinor: 900_000,
      currency: "USD",
      reason: "Above the auto-approval threshold",
    });

  it("keeps a single pending approval per subject", async () => {
    const a = await ask();
    const b = await ask();
    expect(b).toEqual({ approvalId: a.approvalId, created: false });
  });

  it("records the human decision in the audit trail and refuses a second resolution", async () => {
    const { approvalId } = await ask();
    await resolveApproval(db, approvalId, { decision: "approved", by: "ria@treza.dev", note: "Budgeted" });
    await expect(resolveApproval(db, approvalId, { decision: "rejected", by: "x" })).rejects.toBeInstanceOf(
      ApprovalError,
    );
    const [entry] = await listAudit(db, { subjectId: "pr_1" });
    expect(entry.actor).toBe("human");
    expect(entry.action).toBe("approval.approved");
  });

  it("refuses to edit the audit trail", async () => {
    const { approvalId } = await ask();
    await resolveApproval(db, approvalId, { decision: "rejected", by: "ria" });
    await expect(db.query("UPDATE audit_log SET actor = 'system'")).rejects.toThrow(/append-only/);
  });

  it("refuses an approval by the person who asked, in code and in the database", async () => {
    const { approvalId } = await requestApproval(db, {
      tenantId: "platform", kind: "purchase", subjectType: "purchase_request", subjectId: "pr_2", reason: "Over limit", requestedBy: "Maya Chen",
    });
    await expect(resolveApproval(db, approvalId, { decision: "approved", by: " maya chen" })).rejects.toThrow(/different person/);
    await expect(
      db.query("UPDATE approvals SET status = 'approved', resolved_by = 'Maya Chen' WHERE id = $1", [approvalId]),
    ).rejects.toThrow(/cannot be resolved by its requester/);
    const row = await resolveApproval(db, approvalId, { decision: "approved", by: "Priya Shah" });
    expect(row.status).toBe("approved");
  });

  it("lapses an approval nobody acted on and refuses a late decision", async () => {
    const { approvalId } = await requestApproval(db, {
      tenantId: "platform", kind: "purchase", subjectType: "purchase_request", subjectId: "pr_3", reason: "Over limit", requestedBy: "Maya Chen",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const later = new Date(Date.now() + 120_000);
    expect(await sweepExpiredApprovals(db, new Date())).toHaveLength(0);
    await expect(resolveApproval(db, approvalId, { decision: "approved", by: "Priya Shah", now: later })).rejects.toThrow(/expired/);
    const [row] = await db.query<{ status: string }>("SELECT status FROM approvals WHERE id = $1", [approvalId]);
    expect(row.status).toBe("expired");
    const [entry] = await listAudit(db, { subjectId: "pr_3" });
    expect(entry.action).toBe("approval.expired");
    expect(entry.actor).toBe("system");
  });
});
