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

async function Overview() {
  await connection();
  const o = await loadOverview();
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-1">
        <Panel title="Setup">
          <ul className="space-y-3">
            {o.setup.map((s) => (
              <li key={s.label} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <p>{s.label}</p>
                  <p className="text-xs text-muted">{s.detail}</p>
                </div>
                <Chip tone={s.ok ? "good" : "warn"}>{s.ok ? "Ready" : "Needed"}</Chip>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Platform ledger">
          {o.balances.length === 0 ? (
            <Empty>No entries yet. A settled deposit webhook will appear here.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {o.balances.map((b) => (
                <li key={`${b.code}-${b.currency}`} className="flex justify-between gap-3">
                  <span className="font-mono text-xs text-muted">{b.code}</span>
                  <span className="tabular-nums">{format(b.balanceMinor, b.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="space-y-4 lg:col-span-2">
        <Panel title="Event ledger">
          {o.events.length === 0 ? (
            <Empty>No events yet. Airwallex webhooks and Treza decisions land here.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="pb-2 font-normal">Event</th>
                    <th className="pb-2 font-normal">Tenant</th>
                    <th className="pb-2 font-normal">Status</th>
                    <th className="pb-2 font-normal">Occurred</th>
                  </tr>
                </thead>
                <tbody>
                  {o.events.map((e) => (
                    <tr key={e.id} className="border-t border-line">
                      <td className="py-2 font-mono text-xs">{e.type}</td>
                      <td className="py-2 text-muted">{e.tenant_id ?? "platform"}</td>
                      <td className="py-2">
                        <Chip tone={e.status === "processed" ? "good" : e.status === "failed" ? "bad" : "neutral"}>
                          {e.status}
                        </Chip>
                      </td>
                      <td className="py-2 text-xs text-muted">{new Date(e.occurred_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Audit trail">
          {o.audit.length === 0 ? (
            <Empty>Every decision by rules, a model, a person or the system is recorded here and can never be edited.</Empty>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {o.audit.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex items-center gap-2">
                    <Chip tone={a.actor === "model" ? "accent" : "neutral"}>{a.actor}</Chip>
                    <span className="font-mono text-xs">{a.action}</span>
                  </span>
                  <span className="text-xs text-muted">
                    {a.subject_type} {a.subject_id}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
