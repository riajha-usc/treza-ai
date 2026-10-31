import { AirwallexError } from "../airwallex/client";
import { onceForOperation } from "../airwallex/idempotency";
import { requestApproval, resolveApproval } from "../approvals/approvals";
import { recordDecision } from "../audit/audit";
import type { Db } from "../db/client";
import { PLATFORM_ACCOUNTS } from "../ledger/accounts";
import { postEntry } from "../ledger/ledger";
import { format } from "../money/money";
import { PLATFORM_TENANT_ID } from "../tenancy";
import { getDispute, type DisputeDecision, type DisputeDeps } from "./agent";
import { DEFAULT_DISPUTE_POLICY } from "./assess";
import { buildEvidencePdf } from "./packet";
import { availableDocuments, getOrder, orderSummary } from "./records";

/** Books a cost of a dispute against the platform's cash, exactly once. */
export async function book(db: Db, key: string, account: { code: string; type: "expense" }, minor: number, currency: string, description: string) {
  if (minor <= 0) return;
  await postEntry(db, {
    idempotencyKey: key,
    kind: "dispute",
    description,
    lines: [
      { tenantId: PLATFORM_TENANT_ID, account, amountMinor: minor, currency },
      { tenantId: PLATFORM_TENANT_ID, account: PLATFORM_ACCOUNTS.cash, amountMinor: -minor, currency },
    ],
  });
}

/** Carries out the dispute decision: challenge with evidence, accept, or ask a person. */
export async function executeDispute(deps: DisputeDeps, disputeId: string, override?: "challenge" | "accept"): Promise<string> {
  const { db } = deps;
  const d = await getDispute(db, disputeId);
  const decision = d.decision as unknown as DisputeDecision;
  const action = override ?? decision.action;
  if (d.status !== "REQUIRES_RESPONSE") return `No action: dispute status is ${d.status}`;

  if (action === "escalate") {
    const { created } = await requestApproval(db, {
      tenantId: d.seller_tenant_id ?? PLATFORM_TENANT_ID,
      kind: "dispute",
      subjectType: "dispute",
      subjectId: d.id,
      amountMinor: d.amount_minor,
      currency: d.currency,
      reason: decision.reasons.join(". "),
      payload: { stage: d.stage, evidenceHash: decision.evidenceHash },
    });
    return created ? "Escalated to a person" : "Already waiting for a person";
  }
  if (!deps.gateway) return "Airwallex is not configured";
  const order = d.order_id ? await getOrder(db, d.order_id) : null;

  try {
    if (action === "accept") {
      const reason = d.amount_minor < (deps.policy ?? DEFAULT_DISPUTE_POLICY).challengeFeeMinor * 5 ? "LOW_VALUE_TRANSACTION" : "VALID_CUSTOMER_DISPUTE";
      const { result } = await onceForOperation(
        db,
        { key: `dispute:${d.id}:accept`, tenantId: d.seller_tenant_id, method: "POST", path: "/api/v1/pa/payment_disputes/accept" },
        (requestId) => deps.gateway!.acceptDispute(d.airwallex_dispute_id, { requestId, reason, description: decision.reasons.join(". ") }),
      );
      await db.query("INSERT INTO dispute_submissions (dispute_id, stage, action) VALUES ($1, $2, 'accept')", [d.id, d.stage]);
      await db.query("UPDATE disputes SET status = $2, updated_at = now() WHERE id = $1", [d.id, result.status ?? "ACCEPTED"]);
      await book(db, `dispute-loss:${d.id}`, PLATFORM_ACCOUNTS.disputeLosses, d.amount_minor, d.currency, `Accepted dispute on order ${d.order_id}`);
      await recordDecision(db, { tenantId: d.seller_tenant_id, actor: "system", action: "dispute.accepted", subjectType: "dispute", subjectId: d.id, outcome: { reason, amount: format(d.amount_minor, d.currency) } });
      return `Accepted (${reason})`;
    }

    // Challenge: never the same evidence twice for this dispute.
    if (!order) return "No order to build evidence from";
    const [dup] = await db.query("SELECT 1 FROM dispute_submissions WHERE dispute_id = $1 AND evidence_hash = $2", [d.id, decision.evidenceHash]);
    if (dup) return "Refused: this exact evidence was already submitted";
    const docs = (await availableDocuments(db, order.id)).filter((doc) => decision.evidenceDocIds.includes(doc.id));
    const pdf = await buildEvidencePdf({
      merchant: "Meridian Market",
      disputeId: d.airwallex_dispute_id,
      reasonCode: d.reason_code ?? "",
      reasonLabel: decision.assessment.reasonLabel,
      amount: format(d.amount_minor, d.currency),
      orderId: order.id,
      orderSummary: orderSummary(order),
      facts: decision.facts.filter((f) => f.source === "order_record" || decision.evidenceDocIds.includes(f.source)),
      documents: docs,
    });
    const hash = decision.evidenceHash.slice(0, 12);
    const { result: file } = await onceForOperation(
      db,
      { key: `dispute:${d.id}:upload:${hash}`, tenantId: d.seller_tenant_id, method: "POST", path: "/api/v1/files/upload" },
      () => deps.gateway!.uploadEvidence(pdf, `evidence-${order.id}-${hash}.pdf`),
    );
    const { result } = await onceForOperation(
      db,
      { key: `dispute:${d.id}:challenge:${hash}`, tenantId: d.seller_tenant_id, method: "POST", path: "/api/v1/pa/payment_disputes/challenge" },
      (requestId) =>
        deps.gateway!.challengeDispute(d.airwallex_dispute_id, {
          request_id: requestId,
          reason: d.reason_code === "10.4" ? "PURCHASE_HISTORY" : "PRODUCT_RECEIVED",
          product_type: "PHYSICAL_GOODS",
          product_description: orderSummary(order)[1],
          supporting_documents: {
            documents: [{ type: "PRIMARY", file_ids: [file.file_id], description: `Verified evidence for order ${order.id}` }],
          },
        }),
    );
    await db.query(
      "INSERT INTO dispute_submissions (dispute_id, stage, action, evidence_hash, document_ids, file_ids) VALUES ($1, $2, 'challenge', $3, $4, $5)",
      [d.id, d.stage, decision.evidenceHash, JSON.stringify(decision.evidenceDocIds), JSON.stringify([file.file_id])],
    );
    await db.query("UPDATE disputes SET status = $2, updated_at = now() WHERE id = $1", [d.id, result.status ?? "CHALLENGED"]);
    await book(db, `dispute-fee:${d.id}:${d.stage}`, PLATFORM_ACCOUNTS.disputeFees, decision.economics.challengeFeeMinor, d.currency, `Challenge fee for dispute on order ${order.id}`);
    await recordDecision(db, { tenantId: d.seller_tenant_id, actor: "system", action: "dispute.challenged", subjectType: "dispute", subjectId: d.id, outcome: { fileId: file.file_id, documents: decision.evidenceDocIds, stage: d.stage } });
    return `Challenged with ${decision.evidenceDocIds.length} new document(s)`;
  } catch (err) {
    const message = err instanceof AirwallexError ? `${err.code}: ${err.message}` : String(err);
    await recordDecision(db, { tenantId: d.seller_tenant_id, actor: "system", action: `dispute.${action}_failed`, subjectType: "dispute", subjectId: d.id, outcome: { error: message } });
    return `Failed: ${message}`;
  }
}

/** A person settles an escalated dispute by choosing to challenge or accept. */
export async function resolveDisputeEscalation(deps: DisputeDeps, approvalId: string, choice: "challenge" | "accept", by: string): Promise<string> {
  const approval = await resolveApproval(deps.db, approvalId, { decision: "approved", by, note: `Chose to ${choice}` });
  return executeDispute(deps, approval.subject_id, choice);
}
