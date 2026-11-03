import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { subjectHref } from "@/components/records";
import { dateTime } from "@/components/time";
import { Empty, PageHeader, Panel, Tag } from "@/components/ui";
import { format } from "@/lib/money/money";
import { loadApprovals } from "@/lib/queries/controls";

const STATUS = { pending: ["warn", "Waiting"], approved: ["good", "Approved"], rejected: ["bad", "Rejected"], expired: ["bad", "Expired"] } as const;

export default function ApprovalsPage() {
  return (
    <main className="flex flex-col gap-4 p-6">
      <PageHeader title="Approvals" subtitle="Decisions above policy limits wait here for a person other than the requester. Each approval is bound to the exact terms it was asked about and lapses if nobody acts." />
      <Suspense fallback={<Panel title="Queue"><Empty>Loading approvals...</Empty></Panel>}>
        <Approvals />
      </Suspense>
    </main>
  );
}

async function Approvals() {
  await connection();
  const rows = await loadApprovals();
  const pending = rows.filter((r) => r.status === "pending");
  const resolved = rows.filter((r) => r.status !== "pending");
  return (
    <>
      <Panel title="Waiting for a person" meta={`${pending.length} open`}>
        <ApprovalTable rows={pending} empty="Nothing is waiting for a person." />
      </Panel>
      <Panel title="Resolved" meta={`${resolved.length} total`}>
        <ApprovalTable rows={resolved} empty="No approvals resolved yet." />
      </Panel>
    </>
  );
}

function ApprovalTable({ rows, empty }: { rows: Awaited<ReturnType<typeof loadApprovals>>; empty: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr><th>Type</th><th>Tenant</th><th className="num">Amount</th><th>Why a person decides</th><th>Requested by</th><th>Expires</th><th>Status</th><th>Decided by</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const href = subjectHref(a.subject_type, a.subject_id);
            const [tone, label] = STATUS[a.status];
            return (
              <tr key={a.id}>
                <td className="capitalize">{a.kind.replaceAll("_", " ")}</td>
                <td>{a.tenantName}</td>
                <td className="num">{a.amount_minor != null && a.currency ? format(a.amount_minor, a.currency) : ""}</td>
                <td className="text-ink-2">{a.reason}</td>
                <td>{a.requested_by ?? <span className="text-muted">Agent</span>}<div className="whitespace-nowrap text-xs text-muted">{dateTime(a.requested_at)}</div></td>
                <td className="whitespace-nowrap text-muted">{a.expires_at ? dateTime(a.expires_at) : ""}</td>
                <td><Tag tone={tone}>{label}</Tag></td>
                <td className="text-ink-2">{a.resolved_by ?? ""}</td>
                <td className="num">{href ? <Link href={href} className="btn btn-sm">{a.status === "pending" ? "Review" : "Open"}</Link> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
