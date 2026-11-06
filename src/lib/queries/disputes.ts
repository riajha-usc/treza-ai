import { getApp } from "../app";
import type { ApprovalRow } from "../approvals/approvals";
import { sweepExpiredApprovals } from "../approvals/sweep";
import { listRefunds } from "../disputes/refunds";
import { listAudit } from "../audit/audit";
import type { DisputeDecision } from "../disputes/agent";
import type { DisputeRow, OrderRow } from "../disputes/records";

export type DisputeListRow = DisputeRow & { seller_name: string | null };

export async function loadDisputeList() {
  const { db, disputes } = await getApp();
  // The sandbox account can hold disputes on payments Treza never recorded (other databases, other runs). They are counted, not queued.
  const rows = await db.query<DisputeListRow>(
    `SELECT d.*, t.name AS seller_name FROM disputes d LEFT JOIN tenants t ON t.id = d.seller_tenant_id
     WHERE d.order_id IS NOT NULL ORDER BY d.created_at DESC LIMIT 100`,
  );
  const [{ unmatched }] = await db.query<{ unmatched: number }>("SELECT count(*)::int AS unmatched FROM disputes WHERE order_id IS NULL");
  return { rows, unmatched, canStage: Boolean(disputes.gateway && disputes.simulator), canSync: Boolean(disputes.gateway) };
}

export async function loadDisputeDetail(id: string) {
  const { db, disputes } = await getApp();
  await sweepExpiredApprovals(db);
  const [row] = await db.query<DisputeListRow>(
    "SELECT d.*, t.name AS seller_name FROM disputes d LEFT JOIN tenants t ON t.id = d.seller_tenant_id WHERE d.id = $1",
    [id],
  );
  if (!row) throw new Error(`Unknown dispute ${id}`);
  const [order] = row.order_id ? await db.query<OrderRow>("SELECT * FROM orders WHERE id = $1", [row.order_id]) : [];
  const documents = row.order_id
    ? await db.query<{ id: string; kind: string; title: string; body: string; shared: boolean }>(
        "SELECT id, kind, title, body, available_at <= now() AS shared FROM order_documents WHERE order_id = $1 ORDER BY id",
        [row.order_id],
      )
    : [];
  const submissions = await db.query<{ id: string; stage: string; action: string; document_ids: string[]; file_ids: string[]; created_at: string }>(
    "SELECT * FROM dispute_submissions WHERE dispute_id = $1 ORDER BY created_at",
    [id],
  );
  const [approval] = await db.query<ApprovalRow>(
    "SELECT * FROM approvals WHERE subject_type = 'dispute' AND subject_id = $1 ORDER BY requested_at DESC LIMIT 1",
    [id],
  );
  const refunds = row.order_id ? await listRefunds(db, row.order_id) : [];
  return {
    row,
    decision: (Object.keys(row.decision).length ? row.decision : null) as DisputeDecision | null,
    order: order ?? null,
    refunds,
    documents,
    submissions,
    approval: approval ?? null,
    audit: await listAudit(db, { subjectId: id }),
    canSimulate: Boolean(disputes.simulator),
  };
}

export type DisputeDetail = Awaited<ReturnType<typeof loadDisputeDetail>>;
