import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Chip, Empty, Panel } from "@/components/ui";
import { format } from "@/lib/money/money";
import { loadDisputeDetail } from "@/lib/queries/disputes";
import { decideEscalationAction, issuerRejectsAction, resolveAction } from "../actions";
import { DecisionPanel, EvidencePanel } from "./panels";

const btn = "rounded-lg border px-3 py-1.5 text-xs font-medium hover:opacity-90";

export default function DisputeDetailPage({ params }: PageProps<"/disputes/[id]">) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link href="/disputes" className="text-xs text-muted hover:text-text">
        All disputes
      </Link>
      <Suspense fallback={<Empty>Loading dispute...</Empty>}>{params.then(({ id }) => <Detail id={id} />)}</Suspense>
    </main>
  );
}

async function Detail({ id }: { id: string }) {
  await connection();
  const d = await loadDisputeDetail(id);
  const { row, order } = d;
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  return (
    <div className="mt-3 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium">
            {row.order_id} · {format(row.amount_minor, row.currency)}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {row.seller_name} · {order?.buyer_name} · Airwallex {row.airwallex_dispute_id}
          </p>
        </div>
        <Chip tone={row.status === "WON" ? "good" : row.status === "LOST" ? "bad" : "neutral"}>
          {row.stage} {row.status}
        </Chip>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <EvidencePanel d={d} />
        <DecisionPanel d={d} />
      </div>
      {d.approval ? (
        <Panel title="A person decides">
          <p className="mb-3 text-sm text-muted">{d.approval.reason}</p>
          <form action={decideEscalationAction} className="flex gap-2">
            {hidden("approvalId", d.approval.id)}
            {hidden("disputeId", row.id)}
            <button name="choice" value="challenge" className={`${btn} border-accent-line text-accent-text`}>Challenge</button>
            <button name="choice" value="accept" className={`${btn} border-line text-muted`}>Accept and refund</button>
          </form>
        </Panel>
      ) : null}
      <Panel title="Submissions to Airwallex" action={d.submissions.some((s) => s.action === "challenge") ? <a href={`/api/disputes/${row.id}/evidence`} className="font-mono text-xs text-accent-text hover:underline">Evidence PDF</a> : null}>
        {d.submissions.length === 0 ? (
          <Empty>Nothing submitted yet.</Empty>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {d.submissions.map((s) => (
              <li key={s.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {s.action} at {s.stage}
                  {s.document_ids.length ? ` with ${s.document_ids.join(", ")}` : ""}
                </span>
                <span className="text-xs text-muted">{new Date(s.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {d.canSimulate ? (
        <Panel title="Sandbox: what the card network does next">
          <div className="flex flex-wrap gap-2">
            {row.status === "CHALLENGED" && row.stage === "RFI" ? (
              <form action={issuerRejectsAction}>
                {hidden("disputeId", row.id)}
                <button className={`${btn} border-warn/50 text-warn`}>Issuer rejects the evidence</button>
              </form>
            ) : null}
            {["CHALLENGED", "PENDING_DECISION"].includes(row.status) ? (
              <form action={resolveAction} className="flex gap-2">
                {hidden("disputeId", row.id)}
                <button name="winner" value="MERCHANT" className={`${btn} border-good/50 text-good`}>Merchant wins</button>
                <button name="winner" value="CUSTOMER" className={`${btn} border-bad/50 text-bad`}>Customer wins</button>
              </form>
            ) : null}
          </div>
        </Panel>
      ) : null}
      <Panel title="Audit trail">
        <ul className="divide-y divide-line text-sm">
          {d.audit.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="flex items-center gap-2">
                <Chip tone={a.actor === "model" ? "accent" : "neutral"}>{a.actor}</Chip>
                <span className="font-mono text-xs">{a.action}</span>
                {a.model ? <span className="text-xs text-muted">{a.model}</span> : null}
              </span>
              <span className="text-xs text-muted">{new Date(a.created_at).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
