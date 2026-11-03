import { CashChart } from "@/components/cash-chart";
import { Empty, Facts, Panel, PanelBody, PanelNote, Tag } from "@/components/ui";
import { format } from "@/lib/money/money";
import type { PurchaseDetail } from "@/lib/queries/purchases";
import { resolvePurchaseAction } from "../actions";

const OUTCOME = { pass: ["good", "Pass"], fail: ["bad", "Fail"], flag: ["warn", "Flag"], info: ["neutral", "Note"] } as const;
const VERDICT = { approve: ["good", "Approve"], deny: ["bad", "Deny"], review: ["warn", "Needs review"] } as const;
const PER = { monthly: " / month", annual: " / year" } as Record<string, string>;

/** The options found in the vendor's terms, each tested against the reserve floor. */
export function DecisionPanel({ d }: { d: PurchaseDetail }) {
  const { row } = d;
  const dec = row.decision;
  const projections = dec.rules?.projections ?? [];
  const source = dec.extraction?.source;
  return (
    <Panel title="Decision" meta={source ? <Tag tone={source === "claude" ? "info" : "neutral"}>{source === "claude" ? "Terms read by Claude" : source === "rules" ? "Terms read by rules" : "Prices provided"}</Tag> : null}>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr><th>Option</th><th className="num">Price</th><th className="num">Lowest cash, {projections[0]?.weeklyBalancesMinor.length ?? 12} weeks</th><th>Result</th></tr>
          </thead>
          <tbody>
            {row.options.map((o) => {
              const p = projections.find((x) => x.optionId === o.id);
              const chosen = dec.chosen?.id === o.id;
              return (
                <tr key={o.id}>
                  <td>{o.label}</td>
                  <td className="num">{format(o.chargeMinor, o.currency)}{PER[o.billing] ?? " once"}</td>
                  <td className={`num ${p?.firstBreachWeek ? "text-bad" : ""}`}>{p ? format(p.lowestBalanceMinor, row.currency) : ""}</td>
                  <td>
                    {chosen ? <Tag tone="good">Selected</Tag> : p?.firstBreachWeek ? <Tag tone="bad">Below floor in week {p.firstBreachWeek}</Tag> : <Tag>Not selected</Tag>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {projections.length ? (
        <div className="border-t border-line px-4 py-3.5">
          <CashChart
            floorMinor={d.reserveFloorMinor}
            currency={row.currency}
            series={projections.map((p) => ({
              label: row.options.find((o) => o.id === p.optionId)?.label ?? p.optionId,
              values: p.weeklyBalancesMinor,
              tone: p.firstBreachWeek ? "bad" : "primary",
              breachWeek: p.firstBreachWeek,
            }))}
          />
        </div>
      ) : null}
      {dec.extraction?.rejected.map((r) => (
        <PanelNote key={r.label}>
          <span className="text-bad">Rejected {r.label}: {r.reason}</span>
        </PanelNote>
      ))}
      <PanelNote>{dec.summary}</PanelNote>
    </Panel>
  );
}

export function RulesPanel({ d }: { d: PurchaseDetail }) {
  const rules = d.row.decision.rules;
  if (!rules) return null;
  const [tone, label] = VERDICT[rules.verdict];
  return (
    <Panel title="Policy rules" meta={<Tag tone={tone}>{label}</Tag>}>
      <table className="tbl">
        <tbody>
          {rules.results.map((r, i) => (
            <tr key={i}>
              <td className="w-24"><Tag tone={OUTCOME[r.outcome][0]}>{OUTCOME[r.outcome][1]}</Tag></td>
              <td className="text-ink-2">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export function ReviewPanel({ d }: { d: PurchaseDetail }) {
  const a = d.row.decision.assessment;
  return (
    <Panel title="Model review" meta={a ? "Claude Sonnet 5.5" : null}>
      {a ? (
        <>
          <Facts rows={[["Recommendation", <span key="r" className="capitalize">{a.recommendation}</span>], ["Confidence", <span key="c" className="capitalize">{a.confidence}</span>]]} />
          <PanelBody className="border-t border-line text-ink-2">{a.summary}</PanelBody>
          {a.concerns.map((c) => (
            <PanelNote key={c}>
              <span className="text-warn">{c}</span>
            </PanelNote>
          ))}
        </>
      ) : (
        <Empty>{d.row.decision.assessmentIssue ?? "Not needed: the rules settled this request on their own."}</Empty>
      )}
    </Panel>
  );
}

export function ApprovalPanel({ d }: { d: PurchaseDetail }) {
  if (!d.approval) return null;
  return (
    <Panel title="Approval" meta={d.approval.status === "pending" ? <Tag tone="warn">Waiting</Tag> : <Tag tone={d.approval.status === "approved" ? "good" : "bad"}>{d.approval.status === "approved" ? "Approved" : "Rejected"} by {d.approval.resolved_by}</Tag>}>
      <PanelBody className="flex flex-col gap-3">
        <p className="text-ink-2">{d.approval.reason}</p>
        {d.approval.status === "pending" ? (
          <form action={resolvePurchaseAction} className="flex gap-2">
            <input type="hidden" name="approvalId" value={d.approval.id} />
            <button name="decision" value="approved" className="btn btn-primary">Approve</button>
            <button name="decision" value="rejected" className="btn btn-danger">Reject</button>
          </form>
        ) : null}
      </PanelBody>
      <PanelNote>The approval is bound to these exact terms and controls by fingerprint.</PanelNote>
    </Panel>
  );
}
