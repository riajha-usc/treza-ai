import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Chip, Empty, Panel } from "@/components/ui";
import type { DisputeDecision } from "@/lib/disputes/agent";
import { format } from "@/lib/money/money";
import { loadDisputeList } from "@/lib/queries/disputes";
import { stageDemoAction, syncDisputesAction } from "./actions";

const ACTION_TONE = { challenge: "accent", accept: "neutral", escalate: "warn" } as const;
const btn = "rounded-lg border px-3 py-1.5 text-xs font-medium hover:opacity-90";

export default function DisputesPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Kit 04</p>
        <h1 className="mt-1 text-2xl font-medium">Dispute defense</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Claude Opus 5.5 reads order documents and cites the exact words it relies on. Code verifies every quote, scores the
          evidence for the Visa reason code, and weighs the challenge fee against the amount at risk.
        </p>
      </header>
      <Suspense fallback={<Empty>Loading disputes...</Empty>}>
        <DisputeQueue />
      </Suspense>
    </main>
  );
}

async function DisputeQueue() {
  await connection();
  const { rows, canStage, canSync } = await loadDisputeList();
  return (
    <Panel
      title="Dispute queue"
      action={
        <div className="flex gap-2">
          {canSync ? (
            <form action={syncDisputesAction}>
              <button className={`${btn} border-line text-muted`}>Sync from Airwallex</button>
            </form>
          ) : null}
          {canStage ? (
            <form action={stageDemoAction}>
              <button className={`${btn} border-accent-line bg-accent text-accent-text`}>Stage demo disputes</button>
            </form>
          ) : null}
        </div>
      }
    >
      {rows.length === 0 ? (
        <Empty>{canStage ? "No disputes yet. Stage the three demo disputes in your Airwallex sandbox." : "Add Airwallex sandbox keys to stage and sync disputes."}</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => {
            const d = r.decision as unknown as DisputeDecision;
            return (
              <li key={r.id}>
                <Link href={`/disputes/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:opacity-80">
                  <div>
                    <p className="text-sm font-medium">
                      {r.order_id} · {format(r.amount_minor, r.currency)} · reason {r.reason_code}
                    </p>
                    <p className="text-xs text-muted">
                      {r.seller_name} · {r.stage} · {r.status}
                      {d?.assessment ? ` · ${Math.round(d.assessment.winProbability * 100)}% win chance` : ""}
                    </p>
                  </div>
                  {d?.action ? <Chip tone={ACTION_TONE[d.action]}>{d.action}</Chip> : <Chip>new</Chip>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
