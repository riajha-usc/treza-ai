import type { Queryable } from "../db/client";
import { recordDecision } from "../audit/audit";

export interface ApprovalRow {
  id: string;
  tenant_id: string;
  kind: string;
  subject_type: string;
  subject_id: string;
  amount_minor: number | null;
  currency: string | null;
  reason: string;
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

export class ApprovalError extends Error {}

/** Opens an approval. At most one pending approval exists per subject. */
export async function requestApproval(
  q: Queryable,
  a: {
    tenantId: string;
    kind: string;
    subjectType: string;
    subjectId: string;
    amountMinor?: number | null;
    currency?: string | null;
    reason: string;
    payload?: Record<string, unknown>;
  },
): Promise<{ approvalId: string; created: boolean }> {
  const rows = await q.query<{ id: string }>(
    `INSERT INTO approvals (tenant_id, kind, subject_type, subject_id, amount_minor, currency, reason, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (kind, subject_type, subject_id) WHERE status = 'pending' DO NOTHING RETURNING id`,
    [
      a.tenantId,
      a.kind,
      a.subjectType,
      a.subjectId,
      a.amountMinor ?? null,
      a.currency ?? null,
      a.reason,
      JSON.stringify(a.payload ?? {}),
    ],
  );
  if (rows.length > 0) return { approvalId: rows[0].id, created: true };
  const existing = await q.query<{ id: string }>(
    "SELECT id FROM approvals WHERE kind = $1 AND subject_type = $2 AND subject_id = $3 AND status = 'pending'",
    [a.kind, a.subjectType, a.subjectId],
  );
  return { approvalId: existing[0].id, created: false };
}

/** A human approves or rejects. Resolving twice is refused. */
export async function resolveApproval(
  q: Queryable,
  approvalId: string,
  r: { decision: "approved" | "rejected"; by: string; note?: string },
): Promise<ApprovalRow> {
  const rows = await q.query<ApprovalRow>(
    `UPDATE approvals SET status = $2, resolved_by = $3, resolution_note = $4, resolved_at = now()
     WHERE id = $1 AND status = 'pending' RETURNING *`,
    [approvalId, r.decision, r.by, r.note ?? null],
  );
  if (rows.length === 0) throw new ApprovalError(`Approval ${approvalId} is not pending`);
  const row = rows[0];
  await recordDecision(q, {
    tenantId: row.tenant_id,
    actor: "human",
    action: `approval.${r.decision}`,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    inputs: { approvalId, kind: row.kind, reason: row.reason },
    outcome: { decision: r.decision, by: r.by, note: r.note ?? null },
  });
  return row;
}

export async function listApprovals(
  q: Queryable,
  filter: { status?: ApprovalRow["status"]; tenantId?: string } = {},
): Promise<ApprovalRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status) where.push(`status = $${params.push(filter.status)}`);
  if (filter.tenantId) where.push(`tenant_id = $${params.push(filter.tenantId)}`);
  return q.query<ApprovalRow>(
    `SELECT * FROM approvals ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY requested_at DESC LIMIT 200`,
    params,
  );
}
