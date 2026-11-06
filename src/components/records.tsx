import Link from "next/link";
import type { AuditRow } from "@/lib/audit/audit";
import { time } from "./time";
import { Actor, Empty } from "./ui";

/** Where a record about a subject lives in the console, if anywhere. */
export function subjectHref(type: string, id: string): string | null {
  if (type === "purchase_request") return `/purchases/${id}`;
  if (type === "dispute") return `/disputes/${id}`;
  if (type === "tenant" || type === "bridge" || type === "settlement") return "/sellers";
  if (type === "story_run") return "/story";
  return null;
}

const LABELS: Record<string, string> = {
  "purchase.received": "Purchase request received",
  "order.refunded": "Refund issued through Airwallex",
  "story.started": "Story run started",
  "story.step_done": "Story step done",
  "story.step_skipped": "Story step skipped",
  "story.step_waiting": "Story step waiting for a person",
  "story.step_failed": "Story step failed",
  "purchase.terms_read": "Vendor terms read",
  "purchase.assessed": "Purpose and category reviewed",
  "card.issued": "Card issued",
  "card.issue_failed": "Card issuance failed",
  "card.issue_refused": "Card issuance refused",
  "dispute.received": "Dispute received",
  "dispute.documents_read": "Order documents read",
  "dispute.challenged": "Dispute challenged",
  "dispute.accepted": "Dispute accepted",
  "dispute.seller_evidence_requested": "Seller asked for evidence",
  "ledger.deposit_booked": "Deposit booked",
  "settlement.reserve_set": "Reserve set",
  "settlement.exposure_recalculated": "Exposure recalculated",
  "seller.onboarded": "Seller onboarded",
  "bridge.repaid": "Bridge repaid",
  "tap.checkout_verified": "TAP checkout verified",
  "tap.checkout_rejected": "TAP checkout rejected",
  "remote_auth.authorized": "Remote authorization approved",
  "remote_auth.declined": "Remote authorization declined",
  "purchase.rules_approve": "Rules approved",
  "purchase.rules_review": "Rules sent to review",
  "purchase.rules_deny": "Rules denied",
  "dispute.decided_challenge": "Decided to challenge",
  "dispute.decided_accept": "Decided to accept",
  "dispute.decided_escalate": "Escalated to a person",
};

/** "purchase.rules_review" reads as "Purchase rules review" when there is no better label. */
export function describe(action: string): string {
  if (LABELS[action]) return LABELS[action];
  const words = action.replace(/[._]/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const SUBJECT: Record<string, string> = { purchase_request: "Purchase", dispute: "Dispute", tenant: "Seller", card: "Card", bridge: "Bridge" };

function Subject({ a, tenantName }: { a: AuditRow; tenantName?: string | null }) {
  const label = tenantName ?? `${SUBJECT[a.subject_type] ?? a.subject_type} ${a.subject_id.slice(0, 8)}`;
  const href = subjectHref(a.subject_type, a.subject_id);
  return href ? (
    <Link href={href} className="hover:text-primary hover:underline">
      {label}
    </Link>
  ) : (
    <span>{label}</span>
  );
}

/** The append-only audit trail as a table. */
export function AuditTable({ rows, showSubject = true, empty }: { rows: (AuditRow & { tenantName?: string | null })[]; showSubject?: boolean; empty: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>Time</th>
            <th>Actor</th>
            <th>Action</th>
            {showSubject ? <th>Subject</th> : null}
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="font-mono text-xs whitespace-nowrap">{time(a.created_at)}</td>
              <td>
                <Actor actor={a.actor} />
              </td>
              <td>{describe(a.action)}</td>
              {showSubject ? (
                <td>
                  <Subject a={a} tenantName={a.tenantName} />
                </td>
              ) : null}
              <td className="text-muted">{[a.model, a.latency_ms != null ? `${a.latency_ms.toLocaleString("en-US")} ms` : null].filter(Boolean).join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
