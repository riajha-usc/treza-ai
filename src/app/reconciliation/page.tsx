import { Suspense } from "react";
import { connection } from "next/server";
import { dateTime } from "@/components/time";
import { Empty, PageHeader, Panel, Tag } from "@/components/ui";
import { loadReconciliationRuns } from "@/lib/queries/controls";

export default function ReconciliationPage() {
  return (
    <main className="flex flex-col gap-4 p-6">
      <PageHeader title="Reconciliation" subtitle="After every settlement cycle, Airwallex wallet movement is compared with ledger cash movement. Any difference blocks the next payout." />
      <Suspense fallback={<Panel title="Runs"><Empty>Loading runs...</Empty></Panel>}>
        <Runs />
      </Suspense>
    </main>
  );
}

async function Runs() {
  await connection();
  const runs = await loadReconciliationRuns();
  return (
    <Panel title="Runs" meta={`${runs.length} total`}>
      {runs.length === 0 ? (
        <Empty>No runs yet. Run a settlement cycle from Sellers.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Checked</th><th>Result</th><th>Findings</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap text-muted">{dateTime(r.created_at)}</td>
                  <td><Tag tone={r.ok ? "good" : "bad"}>{r.ok ? "Matched" : "Needs attention"}</Tag></td>
                  <td>
                    <ul className="flex flex-col gap-0.5 text-ink-2">
                      {r.findings.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
