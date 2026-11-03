import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { AuditTable } from "@/components/records";
import { Empty, PageHeader, Panel } from "@/components/ui";
import type { Actor } from "@/lib/audit/audit";
import { loadAuditLog } from "@/lib/queries/controls";

const FILTERS: { value?: Actor; label: string }[] = [{ label: "All" }, { value: "rules", label: "Rules" }, { value: "model", label: "Model" }, { value: "human", label: "Person" }, { value: "system", label: "System" }];

export default function AuditPage({ searchParams }: PageProps<"/audit">) {
  return (
    <main className="flex flex-col gap-4 p-6">
      <PageHeader title="Audit log" subtitle="Every decision by rules, a model, a person or the system. The database rejects any edit or delete." />
      <Suspense fallback={<Panel title="Decisions"><Empty>Loading audit log...</Empty></Panel>}>
        {searchParams.then((sp) => (
          <Log actor={FILTERS.find((f) => f.value && f.value === sp.actor)?.value} />
        ))}
      </Suspense>
    </main>
  );
}

async function Log({ actor }: { actor?: Actor }) {
  await connection();
  const rows = await loadAuditLog(actor);
  return (
    <Panel
      title="Decisions"
      meta={
        <nav aria-label="Filter by actor" className="flex gap-1">
          {FILTERS.map((f) => (
            <Link
              key={f.label}
              href={f.value ? `/audit?actor=${f.value}` : "/audit"}
              aria-current={f.value === actor ? "page" : undefined}
              className="rounded px-2 py-0.5 text-xs hover:bg-subtle aria-[current=page]:bg-primary-soft aria-[current=page]:font-medium aria-[current=page]:text-primary"
            >
              {f.label}
            </Link>
          ))}
        </nav>
      }
    >
      <AuditTable rows={rows} empty="No decisions recorded yet." />
    </Panel>
  );
}
