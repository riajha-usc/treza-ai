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
  status: "pending" | "approved" | "rejected" | "expired";
  requested_by: string | null;
  requested_at: string;
  expires_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

export class ApprovalError extends Error {}

/** "Maya Chen" and " maya chen" are the same person. The database applies the same rule. */
export const samePerson = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b) && a!.replace(/\s/g, "").toLowerCase() === b!.replace(/\s/g, "").toLowerCase();

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
    /** Who asked. This person can never approve it. */
    requestedBy?: string | null;
    /** After this, the approval lapses and the action never runs. */
    expiresAt?: Date | null;
  },
): Promise<{ approvalId: string; created: boolean }> {
  const rows = await q.query<{ id: string }>(
    `INSERT INTO approvals (tenant_id, kind, subject_type, subject_id, amount_minor, currency, reason, payload, requested_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
      a.requestedBy ?? null,
      a.expiresAt?.toISOString() ?? null,
    ],
  );
  if (rows.length > 0) return { approvalId: rows[0].id, created: true };
  const existing = await q.query<{ id: string }>(
    "SELECT id FROM approvals WHERE kind = $1 AND subject_type = $2 AND subject_id = $3 AND status = 'pending'",
    [a.kind, a.subjectType, a.subjectId],
  );
  return { approvalId: existing[0].id, created: false };
}

/**
 * A human approves or rejects. Refused when the approval is not pending, has
 * expired, or the approver is the person who asked. Resolving twice is refused.
 */
export async function resolveApproval(
  q: Queryable,
  approvalId: string,
  r: { decision: "approved" | "rejected"; by: string; note?: string; now?: Date },
): Promise<ApprovalRow> {
  const [current] = await q.query<ApprovalRow>("SELECT * FROM approvals WHERE id = $1", [approvalId]);
  if (!current || current.status !== "pending") throw new ApprovalError(`Approval ${approvalId} is not pending`);
  if (current.expires_at && new Date(current.expires_at) <= (r.now ?? new Date())) {
    await expireApprovals(q, r.now);
    throw new ApprovalError(`Approval ${approvalId} expired before anyone decided`);
  }
  if (samePerson(current.requested_by, r.by)) {
    throw new ApprovalError(`${r.by} requested this and cannot approve it. A different person must decide.`);
  }
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
    inputs: { approvalId, kind: row.kind, reason: row.reason, requestedBy: row.requested_by },
    outcome: { decision: r.decision, by: r.by, note: r.note ?? null },
  });
  return row;
}

/** Marks every lapsed pending approval expired and records it. Returns what expired. */
export async function expireApprovals(q: Queryable, now: Date = new Date()): Promise<ApprovalRow[]> {
  const rows = await q.query<ApprovalRow>(
    `UPDATE approvals SET status = 'expired', resolved_at = now()
     WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= $1 RETURNING *`,
    [now.toISOString()],
  );
  for (const row of rows) {
    await recordDecision(q, {
      tenantId: row.tenant_id,
      actor: "system",
      action: "approval.expired",
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      inputs: { approvalId: row.id, kind: row.kind, expiresAt: row.expires_at },
      outcome: { requestedBy: row.requested_by },
    });
  }
  return rows;
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
