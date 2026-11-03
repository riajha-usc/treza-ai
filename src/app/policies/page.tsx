import { Suspense } from "react";
import { connection } from "next/server";
import { TierTag } from "@/components/status";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { format } from "@/lib/money/money";
import { RISK_CAP_MULTIPLIER } from "@/lib/purchases/policy";
import { categoryName } from "@/lib/purchases/merchant-categories";
import { loadPolicies } from "@/lib/queries/controls";

export default function PoliciesPage() {
  return (
    <main className="flex flex-col gap-4 p-6">
      <PageHeader title="Spend policies" subtitle="Every limit is enforced by code and by the card itself. A model never sets or changes one. Caps shrink as a tenant's risk rises." />
      <Suspense fallback={<Panel title="Policies"><Empty>Loading policies...</Empty></Panel>}>
        <Policies />
      </Suspense>
    </main>
  );
}

async function Policies() {
  await connection();
  const rows = await loadPolicies();
  return (
    <Panel title="Policies" meta={`${rows.length} tenants`}>
      {rows.length === 0 ? (
        <Empty>No policies yet.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Tenant</th><th>Risk tier</th><th className="num">Reserve floor</th><th className="num">Auto-approve up to</th><th className="num">Person approves from</th>
                <th className="num">Max charge now</th><th>Allowed categories (hover for names)</th><th className="num">Card valid</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ tenant_id, name, kind, policy: p, risk }) => {
                const m = RISK_CAP_MULTIPLIER[risk.tier];
                return (
                  <tr key={tenant_id} className="align-top">
                    <td className="whitespace-nowrap">
                      <b className="font-medium">{name}</b>
                      <div className="text-xs capitalize text-muted">{kind}</div>
                    </td>
                    <td><TierTag tier={risk.tier} /></td>
                    <td className="num">{format(p.reserveFloorMinor, p.currency)}</td>
                    <td className="num">{format(p.autoApproveMaxMinor, p.currency)}</td>
                    <td className="num">{format(p.humanApprovalFromMinor, p.currency)}</td>
                    <td className="num">
                      {format(Math.round(p.maxChargeMinor * m), p.currency)}
                      {m < 1 ? <div className="text-xs text-muted">{m === 0 ? "frozen by risk" : `${m * 100}% of ${format(p.maxChargeMinor, p.currency)}`}</div> : null}
                    </td>
                    <td>
                      <div className="flex max-w-72 flex-wrap gap-1">
                        {p.allowedMerchantCategories.map((c) => (
                          <span key={c} title={categoryName(c)} className="rounded-[3px] border border-line px-1 font-mono text-2xs text-ink-2">
                            {c}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="num">{p.reconsiderAfterDays} days</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
