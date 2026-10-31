import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { StatusChip } from "@/components/status";
import { Chip, Empty, Panel } from "@/components/ui";
import { categoryName } from "@/lib/purchases/merchant-categories";
import { loadPurchaseDetail } from "@/lib/queries/purchases";
import { CardPanel } from "./card-panel";
import { ApprovalPanel, ModelPanel, ProjectionPanel, RulesPanel, TermsPanel } from "./decision-panels";

export default function PurchaseDetailPage({ params }: PageProps<"/purchases/[id]">) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link href="/purchases" className="text-xs text-muted hover:text-text">
        All purchases
      </Link>
      <Suspense fallback={<Empty>Loading decision trace...</Empty>}>
        {params.then(({ id }) => (
          <Detail id={id} />
        ))}
      </Suspense>
    </main>
  );
}

/** The full decision trace for one purchase, one panel per step. */
async function Detail({ id }: { id: string }) {
  await connection();
  const d = await loadPurchaseDetail(id);
  const { row } = d;
  return (
    <div className="mt-3 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium">{row.vendor}</h1>
          <p className="mt-1 text-sm text-muted">
            {d.tenantName} · requested by {row.requester} · {row.merchant_category_code} {categoryName(row.merchant_category_code)}
          </p>
          <p className="mt-3 max-w-2xl text-sm">{row.decision.summary}</p>
        </div>
        <StatusChip status={row.status} />
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <TermsPanel d={d} />
        <RulesPanel d={d} />
      </div>
      <ProjectionPanel d={d} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ModelPanel d={d} />
        <ApprovalPanel d={d} />
      </div>
      <CardPanel d={d} />
      <Panel title="Audit trail">
        <ul className="divide-y divide-line text-sm">
          {d.audit.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="flex items-center gap-2">
                <Chip tone={a.actor === "model" ? "accent" : "neutral"}>{a.actor}</Chip>
                <span className="font-mono text-xs">{a.action}</span>
                {a.model ? <span className="text-xs text-muted">{a.model}</span> : null}
              </span>
              <span className="text-xs text-muted">
                {a.latency_ms ? `${a.latency_ms} ms · ` : ""}
                {new Date(a.created_at).toLocaleTimeString()}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
