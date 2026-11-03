import { Suspense } from "react";
import { connection } from "next/server";
import { Chip, Empty, Panel } from "@/components/ui";
import { format } from "@/lib/money/money";
import { loadSellers } from "@/lib/queries/sellers";
import { bridgeRequestsAction, carrierFailureAction, lumenDepositAction, onboardAction, reconcileAction, runCycleAction } from "./actions";

const btn = "rounded-lg border px-3 py-1.5 text-xs font-medium hover:opacity-90";
const TIER_TONE = { low: "good", elevated: "warn", high: "bad", restricted: "bad" } as const;
const BRIDGE_TONE = { funded: "accent", repaid: "good", deferred: "warn", denied: "bad", requested: "neutral" } as const;

export default function SellersPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Kit 08 and Kit 05</p>
        <h1 className="mt-1 text-2xl font-medium">Seller settlement and bridging</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Each seller is a connected account with its own wallet. Reserves come from that seller&apos;s own refund history, tenure
          and risk, so a chargeback or a carrier failure at one seller never moves another seller&apos;s money.
        </p>
      </header>
      <Suspense fallback={<Empty>Loading sellers...</Empty>}>
        <Sellers />
      </Suspense>
    </main>
  );
}

async function Sellers() {
  await connection();
  const d = await loadSellers();
  const action = (fn: () => Promise<void>, label: string, tone = "border-line text-muted") => (
    <form action={fn}>
      <button className={`${btn} ${tone}`}>{label}</button>
    </form>
  );
  return (
    <div className="space-y-4">
      <Panel title="Demo steps">
        {!d.connected ? (
          <Empty>Add Airwallex sandbox keys to run settlement.</Empty>
        ) : (
          <div className="space-y-3">
            {!d.identitiesReady ? (
              <p className="text-xs text-warn">
                To onboard sellers, add {d.identitiesEnv} to your .env with sandbox test values you choose. See .env.example.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {action(onboardAction, "1. Onboard sellers")}
              {action(runCycleAction, "2. Run settlement cycle", "border-accent-line bg-accent text-accent-text")}
              {action(carrierFailureAction, "3. Carrier failure at Lumen", "border-warn/50 text-warn")}
              {action(bridgeRequestsAction, "4. Late deposits: bridge requests")}
              {action(lumenDepositAction, "5. Lumen's deposit arrives")}
              {d.lastCycleId ? (
                <form action={reconcileAction}>
                  <input type="hidden" name="cycleId" value={d.lastCycleId} />
                  <button className={`${btn} border-good/50 text-good`}>Reconcile</button>
                </form>
              ) : null}
            </div>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        {d.rows.map(({ seller, risk, position, line, bridges }) => (
          <Panel key={seller.id} title={seller.name} action={<Chip tone={TIER_TONE[risk.tier]}>{risk.tier} risk</Chip>}>
            <div className="space-y-2 text-sm">
              <p className="font-mono text-xs text-muted">{seller.airwallex_account_id ?? "Not onboarded yet"}</p>
              {risk.reasons.map((r) => (
                <p key={r} className="text-xs text-warn">
                  {r}
                </p>
              ))}
              <p>
                <span className="text-muted">Reserve held:</span> {format(position.reserveMinor, "USD")}
                {line ? ` (${(line.reserve_rate_bps / 100).toFixed(1)}% rate)` : ""}
              </p>
              {line ? (
                <p>
                  <span className="text-muted">Last payout:</span> {format(line.payout_minor, "USD")} <Chip tone={line.transfer_status === "SETTLED" ? "good" : "neutral"}>{line.transfer_status ?? "not sent"}</Chip>
                </p>
              ) : null}
              {position.receivableMinor ? (
                <p>
                  <span className="text-muted">Owes the platform:</span> {format(position.receivableMinor, "USD")}
                </p>
              ) : null}
              {line?.explanation.map((e) => (
                <p key={e} className="text-xs text-muted">
                  {e}
                </p>
              ))}
              {bridges.map((b) => (
                <div key={b.id} className="rounded-lg border border-line p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span>Bridge {format(b.amount_minor, "USD")}</span>
                    <Chip tone={BRIDGE_TONE[b.status as keyof typeof BRIDGE_TONE] ?? "neutral"}>{b.status}</Chip>
                  </div>
                  <p className="mt-1 text-muted">{b.decision.reason ?? b.purpose}</p>
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Reconciliation" action={d.reconciliation ? <Chip tone={d.reconciliation.ok ? "good" : "bad"}>{d.reconciliation.ok ? "balanced" : "needs attention"}</Chip> : null}>
          {d.reconciliation ? (
            <ul className="space-y-1 text-sm">
              {d.reconciliation.findings.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : (
            <Empty>Run a settlement cycle to reconcile it against Airwallex.</Empty>
          )}
        </Panel>
        <Panel title="New evidence">
          {d.exposures.length === 0 ? (
            <Empty>No exposure events yet.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.exposures.map((e) => (
                <li key={e.created_at}>
                  <p>
                    {e.kind.replace("_", " ")} at {e.tenant_id}: exposure {format(e.exposure_minor, "USD")}
                  </p>
                  <p className="text-xs text-muted">
                    Shortfall {format(e.resolution.shortfallMinor ?? 0, "USD")}, charged {format(e.resolution.chargedMinor ?? 0, "USD")}, owed {format(e.resolution.owedMinor ?? 0, "USD")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
