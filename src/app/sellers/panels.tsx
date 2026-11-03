import { dateTime } from "@/components/time";
import { Bar, Empty, Panel, PanelBody, PanelNote, Tag, type Tone } from "@/components/ui";
import { format } from "@/lib/money/money";
import type { loadSellers } from "@/lib/queries/sellers";
import { bridgeRequestsAction, carrierFailureAction, lateDepositsAction, onboardAction, runCycleAction } from "./actions";

export const usd = (minor: number) => format(minor, "USD");
const BRIDGE: Record<string, [Tone, string]> = { funded: ["info", "Funded"], repaid: ["good", "Repaid"], deferred: ["warn", "Deferred"], denied: ["bad", "Denied"], requested: ["neutral", "Requested"] };

/** Bridge funding, new exposure evidence, reconciliation and the demo steps below the settlement table. */
export function SettlementDetails({ d }: { d: Awaited<ReturnType<typeof loadSellers>> }) {
  const outstanding = d.bridges.filter((b) => b.status === "funded").reduce((sum, b) => sum + b.amount_minor, 0);
  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Panel title="Bridge funding" meta={`${usd(d.bridgePolicy.facilityMinor)} facility · ${usd(d.bridgePolicy.perSellerCapMinor)} per seller`}>
          <div className="flex flex-col gap-2 border-b border-line px-4 py-3.5">
            <div className="flex justify-between">
              <span>Outstanding</span>
              <span className="tabular-nums">{usd(outstanding)} of {usd(d.bridgePolicy.facilityMinor)}</span>
            </div>
            <Bar pct={(outstanding / d.bridgePolicy.facilityMinor) * 100} />
          </div>
          {d.bridges.length === 0 ? (
            <Empty>No bridge requests yet.</Empty>
          ) : (
            <table className="tbl">
              <thead><tr><th>Seller</th><th className="num">Requested</th><th>Decision</th><th>Reason</th><th>When</th></tr></thead>
              <tbody>
                {d.bridges.map((b) => {
                  const [tone, label] = BRIDGE[b.status] ?? ["neutral", b.status];
                  return (
                    <tr key={b.id}>
                      <td>{b.tenant_name}</td>
                      <td className="num">{usd(b.amount_minor)}</td>
                      <td><Tag tone={tone}>{label}</Tag></td>
                      <td className="text-ink-2">{b.decision.reason ?? b.purpose}</td>
                      <td className="whitespace-nowrap text-muted">{dateTime(b.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="New evidence">
          {d.exposures.length === 0 ? (
            <Empty>No exposure events yet.</Empty>
          ) : (
            <table className="tbl">
              <thead><tr><th>Event</th><th>Seller</th><th className="num">Exposure</th><th className="num">Shortfall</th><th className="num">Charged</th><th className="num">Owed</th></tr></thead>
              <tbody>
                {d.exposures.map((e) => (
                  <tr key={e.created_at}>
                    <td className="capitalize">{e.kind.replaceAll("_", " ")}</td>
                    <td>{d.rows.find((r) => r.seller.id === e.tenant_id)?.seller.name ?? e.tenant_id}</td>
                    <td className="num">{usd(e.exposure_minor)}</td>
                    <td className="num">{usd(e.resolution.shortfallMinor ?? 0)}</td>
                    <td className="num">{usd(e.resolution.chargedMinor ?? 0)}</td>
                    <td className="num">{usd(e.resolution.owedMinor ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <div className="flex flex-col gap-4 xl:w-[376px] xl:flex-none">
        <Panel title="Reconciliation" meta={d.reconciliation ? <Tag tone={d.reconciliation.ok ? "good" : "bad"}>{d.reconciliation.ok ? "Matched" : "Needs attention"}</Tag> : null}>
          {d.reconciliation ? (
            <>
              <ul className="flex flex-col gap-1.5 px-4 py-3.5 text-ink-2">
                {d.reconciliation.findings.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <PanelNote>Checked {dateTime(d.reconciliation.created_at)}. Any difference blocks the next payout.</PanelNote>
            </>
          ) : (
            <Empty>Run a settlement cycle to reconcile it against Airwallex.</Empty>
          )}
        </Panel>

        <Panel title="Demo steps">
          {!d.connected ? (
            <Empty>Add Airwallex sandbox keys to run settlement.</Empty>
          ) : (
            <PanelBody className="flex flex-col gap-2">
              {!d.identitiesReady ? <p className="text-xs text-warn">To onboard sellers, add {d.identitiesEnv} to .env with sandbox test values. See .env.example.</p> : null}
              {(
                [
                  [onboardAction, "1. Onboard sellers"],
                  [runCycleAction, "2. Run settlement cycle"],
                  [carrierFailureAction, "3. Carrier failure at Lumen"],
                  [bridgeRequestsAction, "4. Late deposits: bridge requests"],
                  [lateDepositsAction, "5. Late deposits arrive"],
                ] as const
              ).map(([action, label]) => (
                <form key={label} action={action}>
                  <button className="btn btn-sm w-full justify-start">{label}</button>
                </form>
              ))}
            </PanelBody>
          )}
        </Panel>
      </div>
    </div>
  );
}
