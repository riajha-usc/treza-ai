import { Suspense } from "react";
import { connection } from "next/server";
import { Chip, Empty, Panel } from "@/components/ui";
import { format } from "@/lib/money/money";
import { loadOverview } from "@/lib/queries/overview";

const STAGES = [
  { kit: "Kit 02", title: "Intent-bound purchase", tech: "Rules + Claude Sonnet 5.5", phase: "Oct 29 to 30" },
  { kit: "Kit 05", title: "Tenant cards and bridging", tech: "Airwallex Issuing", phase: "Oct 29 to Nov 4" },
  { kit: "Kit 08", title: "Marketplace settlement", tech: "Reserve ledger + payouts", phase: "Nov 3 to 4" },
  { kit: "Kit 04", title: "Dispute defense", tech: "Claude Opus 5.5 on Bedrock", phase: "Oct 31 to Nov 2" },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Treza AI</p>
          <h1 className="mt-1 text-2xl font-medium sm:text-3xl">Transaction lifecycle console</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Spend control, seller settlement and dispute defense on Airwallex, connected by one shared event ledger.
          </p>
        </div>
        <Suspense fallback={<Chip>Loading</Chip>}>
          <EnvBadge />
        </Suspense>
      </header>

      <ol className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STAGES.map((s, i) => (
          <li key={s.kit} className="rounded-2xl border border-line bg-panel p-4">
            <div className="flex items-center justify-between">
              <span className="rounded-md bg-bg px-2 py-0.5 font-mono text-xs">STAGE 0{i + 1}</span>
              <span className="font-mono text-xs text-muted">{s.kit}</span>
            </div>
            <p className="mt-3 font-medium">{s.title}</p>
            <p className="mt-1 font-mono text-xs italic text-muted">{s.tech}</p>
            <p className="mt-3 text-xs text-muted">In build: {s.phase}</p>
          </li>
        ))}
      </ol>

      <Suspense fallback={<Empty>Loading ledger...</Empty>}>
        <Overview />
      </Suspense>
    </main>
  );
}

async function EnvBadge() {
  await connection();
  const o = await loadOverview();
  return (
    <div className="flex items-center gap-2">
      <Chip>{o.platformName}</Chip>
      <Chip tone="accent">Airwallex {o.environment}</Chip>
    </div>
  );
}

