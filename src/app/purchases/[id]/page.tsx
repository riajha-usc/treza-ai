import { Suspense } from "react";
import { connection } from "next/server";
import { AuditTable } from "@/components/records";
import { StatusChip } from "@/components/status";
import { dateTime } from "@/components/time";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { categoryName } from "@/lib/purchases/merchant-categories";
import { loadPurchaseDetail } from "@/lib/queries/purchases";
import { AgentPanel } from "./agent-panel";
import { CardPanel, TransactionsPanel } from "./card-panel";
import { ApprovalPanel, DecisionPanel, ReviewPanel, RulesPanel } from "./decision-panels";

export default function PurchaseDetailPage({ params }: PageProps<"/purchases/[id]">) {
  return (
    <main className="flex flex-col gap-4 p-6">
      <Suspense fallback={<Empty>Loading decision trace...</Empty>}>
        {params.then(({ id }) => (
          <Detail id={id} />
        ))}
      </Suspense>
    </main>
  );
}

/** One purchase: the decision on the left, the card and agent checkout that enforce it on the right. */
async function Detail({ id }: { id: string }) {
  await connection();
  const d = await loadPurchaseDetail(id);
  const { row } = d;
  return (
    <>
      <PageHeader
        title={row.vendor}
        status={<StatusChip status={row.status} />}
        subtitle={`${d.tenantName} · requested by ${row.requester} · ${row.merchant_category_code} ${categoryName(row.merchant_category_code)} · ${dateTime(row.created_at)}`}
      />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <DecisionPanel d={d} />
          <RulesPanel d={d} />
          <ReviewPanel d={d} />
          <ApprovalPanel d={d} />
          <Panel title="Decision trace" meta={`${d.audit.length} records`}>
            <AuditTable rows={[...d.audit].reverse()} showSubject={false} empty="No decisions recorded yet." />
          </Panel>
        </div>
        <div className="flex flex-col gap-4 xl:w-[376px] xl:flex-none">
          <CardPanel d={d} />
          <TransactionsPanel d={d} />
          <AgentPanel d={d} />
        </div>
      </div>
    </>
  );
}
