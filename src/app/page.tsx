import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { AuditTable, subjectHref } from "@/components/records";
import { dateTime } from "@/components/time";
import { Empty, Figures, PageHeader, Panel, Tag } from "@/components/ui";
import { format } from "@/lib/money/money";
import { loadOverview } from "@/lib/queries/overview";
import { OverviewSide, plural, usd } from "./overview-panels";

export default function Home() {
  return (
    <main className="flex flex-col gap-4 p-6">
      <Suspense fallback={<PageHeader title="Overview" subtitle="Loading..." />}>
        <Overview />
      </Suspense>
    </main>
  );
}

async function Overview() {
  await connection();
  const o = await loadOverview();
  const f = o.figures;
  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={f.cycle ? `Last settlement cycle ${f.cycle}` : "No settlement cycle run yet"}
        actions={o.setup.some((s) => s.label === "Airwallex credentials") ? null : <Link href="/story?play=1" className="btn btn-primary">Run the story</Link>}
      />

      {o.setup.length ? (
        <div className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-warn">
          <b className="font-medium">Setup needed: </b>
          {o.setup.map((s) => s.detail).join(". ")}.
        </div>
      ) : null}

      <Figures
        items={[
          { label: "Overspend blocked", value: usd(f.declinedMinor), note: plural(f.declines, "card decline") },
          { label: "Disputes defended", value: usd(f.defendedMinor), note: `${f.disputesSubmitted} submitted, ${f.disputesAwaiting} awaiting a person` },
          { label: "Seller payouts", value: usd(f.paidMinor), note: `${usd(f.heldMinor)} held in reserve` },
          { label: "Bridge outstanding", value: usd(f.bridgedMinor), note: `of ${usd(f.facilityMinor)} facility` },
          { label: "Authorization time", value: f.authMedianMs != null ? `${f.authMedianMs} ms` : "None yet", note: "median, Airwallex limit 2,500 ms" },
        ]}
      />

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Panel title="Requires approval" meta={<Link href="/approvals" className="hover:text-ink">View all</Link>}>
            {o.approvals.length === 0 ? (
              <Empty>Nothing is waiting for a person.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr><th>Type</th><th>Tenant</th><th className="num">Amount</th><th>Why a person decides</th><th>Requested</th><th /></tr>
                  </thead>
                  <tbody>
                    {o.approvals.slice(0, 5).map((a) => {
                      const href = subjectHref(a.subject_type, a.subject_id);
                      return (
                        <tr key={a.id}>
                          <td><Tag tone={a.kind === "dispute" ? "bad" : "warn"}>{a.kind === "dispute" ? "Dispute" : "Purchase"}</Tag></td>
                          <td>{a.tenantName}</td>
                          <td className="num">{a.amount_minor != null && a.currency ? format(a.amount_minor, a.currency) : ""}</td>
                          <td className="text-ink-2">{a.reason}</td>
                          <td className="whitespace-nowrap text-muted">{dateTime(a.requested_at)}</td>
                          <td className="num">{href ? <Link href={href} className="btn btn-sm">Review</Link> : null}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Agent activity" meta={<Link href="/audit" className="hover:text-ink">Audit log</Link>}>
            <AuditTable rows={o.activity} empty="No decisions yet. Submit a purchase or stage the demo disputes." />
          </Panel>
        </div>

        <OverviewSide o={o} />
      </div>
    </>
  );
}
