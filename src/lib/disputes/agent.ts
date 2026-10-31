import type { AirwallexDispute, DisputeGateway, DisputeSimulator } from "../airwallex/payments";
import { recordDecision } from "../audit/audit";
import type { Db } from "../db/client";
import type { DisputeModel } from "../models/dispute-model";
import { format, toMinor } from "../money/money";
import { recordRiskSignal } from "../risk/risk";
import { assessEvidence, decide, DEFAULT_DISPUTE_POLICY, type DisputeAction, type DisputePolicy } from "./assess";
export type { DisputeAction };
import { verifyFacts, type Fact } from "./facts";
import { availableDocuments, evidenceHash, getOrder, requestSellerEvidence, structuredFacts, type DisputeRow } from "./records";

export interface DisputeDeps {
  db: Db;
  gateway: DisputeGateway | null;
  simulator: DisputeSimulator | null;
  model: DisputeModel | null;
  policy?: DisputePolicy;
}

export interface DisputeDecision {
  action: DisputeAction;
  reasons: string[];
  assessment: ReturnType<typeof assessEvidence>;
  economics: ReturnType<typeof decide>["economics"];
  facts: Fact[];
  rejectedFacts: { code: string; reason: string }[];
  factSource: "claude" | "records_only";
  modelIssue: string | null;
  evidenceDocIds: string[];
  evidenceHash: string;
  sellerEvidenceRequested: string[];
}

const RISK_WEIGHT: Record<string, number> = { "10.4": 20, "13.1": 10, "13.6": 15 };

export async function getDispute(db: Db, id: string): Promise<DisputeRow> {
  const [row] = await db.query<DisputeRow>("SELECT * FROM disputes WHERE id = $1", [id]);
  if (!row) throw new Error(`Unknown dispute ${id}`);
  return row;
}

/** Records a dispute reported by Airwallex. New disputes raise the seller's risk. */
export async function ingestDispute(deps: DisputeDeps, d: AirwallexDispute): Promise<{ row: DisputeRow; isNew: boolean; changed: boolean }> {
  const { db } = deps;
  const [order] = await db.query<{ id: string; seller_tenant_id: string }>(
    "SELECT id, seller_tenant_id FROM orders WHERE payment_intent_id = $1",
    [d.payment_intent_id],
  );
  const code = d.reason?.original_code ?? null;
  const [existing] = await db.query<DisputeRow>("SELECT * FROM disputes WHERE airwallex_dispute_id = $1", [d.id]);
  if (existing) {
    const changed = existing.stage !== d.stage || existing.status !== d.status;
    if (changed) {
      await db.query("UPDATE disputes SET stage = $2, status = $3, due_at = $4, updated_at = now() WHERE id = $1", [existing.id, d.stage, d.status, d.due_at ?? null]);
      await recordDecision(db, { tenantId: existing.seller_tenant_id, actor: "system", action: "dispute.updated", subjectType: "dispute", subjectId: existing.id, outcome: { stage: d.stage, status: d.status } });
    }
    return { row: await getDispute(db, existing.id), isNew: false, changed };
  }
  const [row] = await db.query<DisputeRow>(
    `INSERT INTO disputes (airwallex_dispute_id, payment_intent_id, order_id, seller_tenant_id, amount_minor, currency, reason_type, reason_code, stage, status, due_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [d.id, d.payment_intent_id, order?.id ?? null, order?.seller_tenant_id ?? null, toMinor(Number(d.amount), d.currency), d.currency, d.reason?.type ?? null, code, d.stage, d.status, d.due_at ?? null],
  );
  await recordDecision(db, { tenantId: row.seller_tenant_id, actor: "system", action: "dispute.received", subjectType: "dispute", subjectId: row.id, inputs: { airwallexId: d.id, reasonCode: code, stage: d.stage }, outcome: { amountMinor: row.amount_minor } });
  if (row.seller_tenant_id) {
    const weight = (RISK_WEIGHT[code ?? ""] ?? 10) + (row.amount_minor >= 50_000 ? 10 : 0);
    await recordRiskSignal(db, row.seller_tenant_id, {
      key: `dispute:${d.id}`,
      weight,
      reason: `Chargeback ${code ?? ""} opened on order ${row.order_id} for ${format(row.amount_minor, row.currency)}`,
    });
  }
  return { row, isNew: true, changed: true };
}

