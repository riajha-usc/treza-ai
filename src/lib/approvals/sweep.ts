import type { Queryable } from "../db/client";
import { expireApprovals, type ApprovalRow } from "./approvals";

export const PURCHASE_APPROVAL_HOURS = 72;

/**
 * Lapses overdue approvals and applies the consequence: an unapproved purchase
 * is denied and never gets a card; an undecided dispute sends nothing to
 * Airwallex. Called whenever approvals are read, so no background job is needed.
 */
export async function sweepExpiredApprovals(q: Queryable, now: Date = new Date()): Promise<ApprovalRow[]> {
  const expired = await expireApprovals(q, now);
  for (const a of expired) {
    if (a.kind !== "purchase") continue;
    await q.query(
      `UPDATE purchase_requests SET status = 'denied', updated_at = now(),
         decision = decision || jsonb_build_object('summary', $2::text)
       WHERE id = $1::uuid AND status = 'pending_approval'`,
      [a.subject_id, `Approval expired after ${PURCHASE_APPROVAL_HOURS} hours with no decision. Resubmit to reconsider.`],
    );
  }
  return expired;
}
