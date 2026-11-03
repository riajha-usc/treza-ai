import type { Queryable } from "../db/client";

export type Actor = "rules" | "model" | "human" | "system";

export interface DecisionRecord {
  tenantId?: string | null;
  actor: Actor;
  action: string;
  subjectType: string;
  subjectId: string;
  inputs?: Record<string, unknown>;
  model?: string | null;
  promptVersion?: string | null;
  reasoningSummary?: string | null;
  outcome?: Record<string, unknown>;
  latencyMs?: number | null;
}

export interface AuditRow {
  id: number;
  tenant_id: string | null;
  actor: Actor;
  action: string;
  subject_type: string;
  subject_id: string;
  inputs: Record<string, unknown>;
  model: string | null;
  prompt_version: string | null;
  reasoning_summary: string | null;
  outcome: Record<string, unknown>;
  latency_ms: number | null;
  created_at: string;
}

/** Appends one decision to the audit trail. Rows can never be edited or deleted. */
export async function recordDecision(q: Queryable, d: DecisionRecord): Promise<number> {
  const rows = await q.query<{ id: number }>(
    `INSERT INTO audit_log (tenant_id, actor, action, subject_type, subject_id, inputs, model,
       prompt_version, reasoning_summary, outcome, latency_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      d.tenantId ?? null,
      d.actor,
      d.action,
      d.subjectType,
      d.subjectId,
      JSON.stringify(d.inputs ?? {}),
      d.model ?? null,
      d.promptVersion ?? null,
      d.reasoningSummary ?? null,
      JSON.stringify(d.outcome ?? {}),
      d.latencyMs ?? null,
    ],
  );
  return rows[0].id;
}

export async function listAudit(
  q: Queryable,
  filter: { tenantId?: string; subjectType?: string; subjectId?: string; actor?: Actor; limit?: number } = {},
): Promise<AuditRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.tenantId) where.push(`tenant_id = $${params.push(filter.tenantId)}`);
  if (filter.subjectType) where.push(`subject_type = $${params.push(filter.subjectType)}`);
  if (filter.subjectId) where.push(`subject_id = $${params.push(filter.subjectId)}`);
  if (filter.actor) where.push(`actor = $${params.push(filter.actor)}`);
  const limit = Math.min(filter.limit ?? 100, 500);
  return q.query<AuditRow>(
    `SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY id DESC LIMIT ${limit}`,
    params,
  );
}
