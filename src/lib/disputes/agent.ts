import type { AirwallexDispute, DisputeGateway, DisputeSimulator } from "../airwallex/payments";
import { recordDecision } from "../audit/audit";
import type { Db } from "../db/client";
import type { DisputeModel } from "../models/dispute-model";
import { format, toMinor } from "../money/money";
import { recordRiskSignal } from "../risk/risk";
import { assessEvidence, decide, DEFAULT_DISPUTE_POLICY, type DisputeAction, type DisputePolicy } from "./assess";
export type { DisputeAction };
import { type Fact, type FlaggedDocument, verifyFacts } from "./facts";
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
  /** Documents that tried to instruct the reviewer. Shown, audited, never used as evidence. */
  flaggedDocs: FlaggedDocument[];
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

/** Gathers evidence, scores it, and chooses challenge, accept or escalate. */
export async function evaluateDispute(deps: DisputeDeps, disputeId: string): Promise<DisputeDecision> {
  const { db } = deps;
  const policy = deps.policy ?? DEFAULT_DISPUTE_POLICY;
  const d = await getDispute(db, disputeId);
  const order = d.order_id ? await getOrder(db, d.order_id) : null;
  if (!order) throw new Error(`Dispute ${disputeId} has no matching order`);
  const reasonCode = d.reason_code ?? "unknown";

  const submitted = await db.query<{ document_ids: string[]; evidence_hash: string }>(
    "SELECT document_ids, evidence_hash FROM dispute_submissions WHERE dispute_id = $1 AND action = 'challenge'",
    [d.id],
  );
  const submittedDocs = new Set(submitted.flatMap((s) => s.document_ids));
  const sellerEvidenceRequested: string[] = [];

  const gather = async () => {
    const documents = await availableDocuments(db, order.id);
    let docFacts: Fact[] = [];
    let modelIssue: string | null = null;
    let rejected: { code: string; reason: string }[] = [];
    let flagged: FlaggedDocument[] = [];
    if (deps.model && documents.length) {
      const res = await deps.model.extractFacts({ reasonCode, reasonLabel: assessEvidence(reasonCode, []).reasonLabel, documents });
      await recordDecision(db, { tenantId: d.seller_tenant_id, actor: "model", action: "dispute.documents_read", subjectType: "dispute", subjectId: d.id, model: res.model, promptVersion: res.promptVersion, latencyMs: res.latencyMs, outcome: res.ok ? { facts: res.value.length } : { failed: res.reason, detail: res.detail } });
      if (res.ok) {
        const v = verifyFacts(documents, res.value);
        docFacts = v.verified;
        rejected = v.rejected.map((r) => ({ code: r.fact.code, reason: r.reason }));
        flagged = v.flagged;
        if (flagged.length) {
          await recordDecision(db, { tenantId: d.seller_tenant_id, actor: "rules", action: "dispute.instructions_ignored", subjectType: "dispute", subjectId: d.id, outcome: { documents: flagged } });
        }
      } else modelIssue = `Model ${res.reason}: documents were not read`;
    } else if (documents.length) modelIssue = "Claude is not configured: documents were not read";
    const facts = dedupe([...(await structuredFacts(db, order)), ...docFacts]);
    return { documents, facts, modelIssue, rejected, flagged };
  };

  let g = await gather();
  let citedDocs = [...new Set(g.facts.map((f) => f.source).filter((s) => s !== "order_record"))];
  // After a rejection, only evidence not already submitted may be sent.
  if (submitted.length && citedDocs.every((id) => submittedDocs.has(id))) {
    sellerEvidenceRequested.push(...(await requestSellerEvidence(db, order.id)));
    if (sellerEvidenceRequested.length) {
      await recordDecision(db, { tenantId: d.seller_tenant_id, actor: "system", action: "dispute.seller_evidence_requested", subjectType: "dispute", subjectId: d.id, outcome: { received: sellerEvidenceRequested } });
      g = await gather();
      citedDocs = [...new Set(g.facts.map((f) => f.source).filter((s) => s !== "order_record"))];
    }
  }
  const newDocs = submitted.length ? citedDocs.filter((id) => !submittedDocs.has(id)) : citedDocs;
  const assessment = assessEvidence(reasonCode, g.facts);
  const decided = decide({ amountMinor: d.amount_minor, assessment, policy });
  const { economics } = decided;
  let { action, reasons } = decided;

  if (action === "challenge" && submitted.length && newDocs.length === 0) {
    action = d.amount_minor >= policy.humanAcceptFromMinor ? "escalate" : "accept";
    reasons = ["The issuer rejected our evidence and there is no new evidence to send"];
  }
  if (action === "accept" && g.modelIssue && assessment.strength === "weak" && g.documents.length) {
    action = "escalate";
    reasons = [...reasons, "Documents were not read automatically, so a person should check them before accepting"];
  }

  const decision: DisputeDecision = {
    action,
    reasons,
    assessment,
    economics,
    facts: g.facts,
    rejectedFacts: g.rejected,
    factSource: g.modelIssue ? "records_only" : "claude",
    modelIssue: g.modelIssue,
    evidenceDocIds: newDocs,
    evidenceHash: evidenceHash(newDocs, g.facts),
    sellerEvidenceRequested,
    flaggedDocs: g.flagged,
  };
  await db.query("UPDATE disputes SET decision = $2, updated_at = now() WHERE id = $1", [d.id, JSON.stringify(decision)]);
  await recordDecision(db, {
    tenantId: d.seller_tenant_id,
    actor: "rules",
    action: `dispute.decided_${action}`,
    subjectType: "dispute",
    subjectId: d.id,
    inputs: { reasonCode, stage: d.stage, facts: g.facts.map((f) => f.code) },
    outcome: { action, winProbability: assessment.winProbability, economics, reasons },
  });
  return decision;
}

function dedupe(facts: Fact[]): Fact[] {
  const seen = new Set<string>();
  return facts.filter((f) => (seen.has(f.code) ? false : (seen.add(f.code), true)));
}

