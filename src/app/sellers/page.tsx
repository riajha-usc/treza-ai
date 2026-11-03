import { Suspense } from "react";
import { connection } from "next/server";
import { TierTag } from "@/components/status";
import { Bar, PageHeader, Panel, PanelNote, Tag } from "@/components/ui";
import { loadSellers } from "@/lib/queries/sellers";
import { reconcileAction, runCycleAction } from "./actions";
import { SettlementDetails, usd } from "./panels";

const TIER_BAR = { low: "good", elevated: "warn", high: "bad", restricted: "bad" } as const;

export default function SellersPage() {
  return (
    <main className="flex flex-col gap-4 p-6">
      <Suspense fallback={<PageHeader title="Sellers" subtitle="Loading..." />}>
        <Sellers />
      </Suspense>
    </main>
  );
}

async function Sellers() {
  await connection();
  const d = await loadSellers();
  return (
    <>
      <PageHeader
        title="Sellers"
        subtitle={d.lastCycleId ? `Last settled cycle ${d.lastCycleId} · reserves set by each seller's own risk` : "No settlement cycle run yet"}
        actions={
          d.connected ? (
            <>
              {d.lastCycleId ? (
                <form action={reconcileAction}>
                  <input type="hidden" name="cycleId" value={d.lastCycleId} />
                  <button className="btn">Reconcile</button>
                </form>
              ) : null}
              <form action={runCycleAction}>
                <button className="btn btn-primary">Run settlement cycle</button>
              </form>
            </>
          ) : null
        }
      />

      <Panel title="Settlement" meta={`${d.rows.length} sellers`}>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr><th>Seller</th><th>Risk tier</th><th className="num">Reserve rate</th><th className="w-36" /><th className="num">Open disputes</th><th className="num">Reserve held</th><th className="num">Last payout</th><th>Transfer</th></tr>
            </thead>
            <tbody>
              {d.rows.map(({ seller, risk, position, openDisputesMinor, line }) => (
                <tr key={seller.id} className="align-top">
                  <td>
                    <b className="font-medium">{seller.name}</b>
                    <div className="font-mono text-2xs text-muted">{seller.airwallex_account_id ?? "Not onboarded"}</div>
                    {position.receivableMinor ? <div className="text-xs text-warn">Owes the platform {usd(position.receivableMinor)}</div> : null}
                    {line?.explanation.length ? (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-muted">How the reserve was set</summary>
                        <ul className="mt-1 flex max-w-md flex-col gap-0.5 text-ink-2">
                          {line.explanation.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </td>
                  <td>
                    <TierTag tier={risk.tier} />
                    {risk.reasons.map((r) => (
                      <div key={r} className="mt-1 max-w-48 text-xs text-muted">{r}</div>
                    ))}
                  </td>
                  <td className="num">{line ? `${(line.reserve_rate_bps / 100).toFixed(1)}%` : ""}</td>
                  <td className="pt-4">{line ? <Bar pct={line.reserve_rate_bps / 50} tone={TIER_BAR[risk.tier]} /> : null}</td>
                  <td className="num">{usd(openDisputesMinor)}</td>
                  <td className="num">{usd(position.reserveMinor)}</td>
                  <td className="num">{line ? usd(line.payout_minor) : ""}</td>
                  <td>{line ? <Tag tone={line.transfer_status === "SETTLED" ? "good" : "neutral"}>{line.transfer_status ? line.transfer_status.toLowerCase() : "Not sent"}</Tag> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PanelNote>Reserve rate = trailing refund rate × 2.5, plus 10% for sellers under 90 days, plus a risk premium, kept between 2% and 50%. Open disputes are held in full on top. The bar runs to the 50% cap.</PanelNote>
      </Panel>

      <SettlementDetails d={d} />
    </>
  );
}
