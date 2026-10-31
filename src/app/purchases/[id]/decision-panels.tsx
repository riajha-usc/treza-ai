import { Sparkline } from "@/components/sparkline";
import { Chip, Empty, Panel } from "@/components/ui";
import { format } from "@/lib/money/money";
import type { PurchaseDetail } from "@/lib/queries/purchases";
import { resolvePurchaseAction } from "../actions";

const OUTCOME_TONE = { pass: "good", fail: "bad", flag: "warn", info: "neutral" } as const;
const btn = "rounded-lg border px-3 py-1.5 text-xs font-medium hover:opacity-90";

export function TermsPanel({ d }: { d: PurchaseDetail }) {
  const { row } = d;
  const dec = row.decision;
  return (
    <Panel title="1. Terms read" action={dec.extraction ? <Chip tone={dec.extraction.source === "claude" ? "accent" : "neutral"}>{dec.extraction.source}</Chip> : null}>
      <p className="mb-3 text-xs text-muted">Every price must appear verbatim in the vendor text, or it is rejected.</p>
      <ul className="space-y-2 text-sm">
        {row.options.map((o) => (
          <li key={o.id} className="flex justify-between gap-3">
            <span>{o.label}</span>
            <span className="tabular-nums">
              {format(o.chargeMinor, o.currency)} {o.billing === "monthly" ? "/ month" : o.billing === "annual" ? "/ year" : "once"}
            </span>
          </li>
        ))}
        {dec.extraction?.rejected.map((r) => (
          <li key={r.label} className="text-xs text-bad">
            Rejected {r.label}: {r.reason}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function RulesPanel({ d }: { d: PurchaseDetail }) {
  const dec = d.row.decision;
  return (
    <Panel title="2. Policy rules" action={dec.rules ? <Chip>{dec.rules.verdict}</Chip> : null}>
      <ul className="space-y-2">
        {dec.rules?.results.map((r, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <Chip tone={OUTCOME_TONE[r.outcome]}>{r.outcome}</Chip>
            <span className="text-muted">{r.detail}</span>
          </li>
        ))}
      </ul>
    </Panel>  );
}

export function ProjectionPanel({ d }: { d: PurchaseDetail }) {
  const { row } = d;
  const dec = row.decision;
  if (!dec.rules) return null;
  return (
    <Panel title="Cash projection against the reserve floor">
      <div className="grid gap-4 sm:grid-cols-2">
        {dec.rules.projections.map((p) => {
          const o = row.options.find((x) => x.id === p.optionId);
          return (
            <div key={p.optionId} className="rounded-xl border border-line p-3">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span>{o?.label ?? p.optionId}</span>
                {p.firstBreachWeek ? <Chip tone="bad">breaches week {p.firstBreachWeek}</Chip> : <Chip tone="good">stays above floor</Chip>}
              </div>
              <Sparkline values={p.weeklyBalancesMinor} floor={d.reserveFloorMinor} breachWeek={p.firstBreachWeek} />
              <p className="mt-1 text-xs text-muted">
                Lowest balance {format(p.lowestBalanceMinor, row.currency)} · floor {format(d.reserveFloorMinor, row.currency)}
              </p>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export function ModelPanel({ d }: { d: PurchaseDetail }) {
  const dec = d.row.decision;
  return (
    <Panel title="3. Model review">
      {dec.assessment ? (
        <div className="space-y-2 text-sm">
          <div className="flex gap-2">
            <Chip tone="accent">{dec.assessment.recommendation}</Chip>
            <Chip>{dec.assessment.confidence} confidence</Chip>
          </div>
          <p>{dec.assessment.summary}</p>
          {dec.assessment.concerns.map((c) => (
            <p key={c} className="text-xs text-warn">
              {c}
            </p>
          ))}
        </div>
      ) : (
        <Empty>{dec.assessmentIssue ?? "Not needed: the rules settled this request on their own."}</Empty>
      )}
    </Panel>
  );
}

