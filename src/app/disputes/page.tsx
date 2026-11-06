import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { date } from "@/components/time";
import { Empty, PageHeader, Panel, Tag } from "@/components/ui";
import type { DisputeDecision } from "@/lib/disputes/agent";
import { format } from "@/lib/money/money";
import { loadDisputeList } from "@/lib/queries/disputes";
import { stageDemoAction, syncDisputesAction } from "./actions";
import { ACTION_TAG } from "./tags";

export default function DisputesPage() {
  return (
    <main className="flex flex-col gap-4 p-6">
      <Suspense fallback={<PageHeader title="Disputes" subtitle="Loading..." />}>
        <DisputeQueue />
      </Suspense>
    </main>
  );
}

async function DisputeQueue() {
  await connection();
  const { rows, unmatched, canStage, canSync } = await loadDisputeList();
  return (
    <>
      <PageHeader
        title="Disputes"
        subtitle="Claude Opus 5.5 cites the exact words it relies on. Code checks every quote and weighs the fee against the amount at risk."
        actions={
          <>
            {canSync ? (
              <form action={syncDisputesAction}>
                <button className="btn">Sync from Airwallex</button>
              </form>
            ) : null}
            {canStage ? (
              <form action={stageDemoAction}>
                <button className="btn btn-primary">Stage demo disputes</button>
              </form>
            ) : null}
          </>
        }
      />
      <Panel title="Dispute queue" meta={`${rows.length} total${unmatched ? ` · ${unmatched} on payments Treza did not record` : ""}`}>
        {rows.length === 0 ? (
          <Empty>{canStage ? "No disputes yet. Stage the three demo disputes in your Airwallex sandbox." : "Add Airwallex sandbox keys to stage and sync disputes."}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr><th>Order</th><th>Seller</th><th>Reason</th><th className="num">Amount</th><th>Stage</th><th className="num">Win chance</th><th>Decision</th><th>Due</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const d = (Object.keys(r.decision).length ? r.decision : null) as DisputeDecision | null;
                  const [tone, label] = d ? ACTION_TAG[d.action] : (["neutral", "New"] as const);
                  return (
                    <tr key={r.id} className="link">
                      <td>
                        <Link href={`/disputes/${r.id}`} className="font-medium text-primary hover:underline">
                          {r.order_id ?? r.airwallex_dispute_id.slice(0, 10)}
                        </Link>
                      </td>
                      <td>{r.seller_name}</td>
                      <td className="text-ink-2">{r.reason_code}{d ? ` ${d.assessment.reasonLabel}` : ""}</td>
                      <td className="num">{format(r.amount_minor, r.currency)}</td>
                      <td className="text-ink-2">{r.stage} · {r.status.replaceAll("_", " ").toLowerCase()}</td>
                      <td className="num">{d ? `${Math.round(d.assessment.winProbability * 100)}%` : ""}</td>
                      <td><Tag tone={tone}>{label}</Tag></td>
                      <td className="whitespace-nowrap text-muted">{r.due_at ? date(r.due_at) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
