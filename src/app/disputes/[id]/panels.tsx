import { Chip, Empty, Panel } from "@/components/ui";
import { FACTS } from "@/lib/disputes/facts";
import { format } from "@/lib/money/money";
import type { DisputeDetail } from "@/lib/queries/disputes";

export function EvidencePanel({ d }: { d: DisputeDetail }) {
  const titles = new Map(d.documents.map((doc) => [doc.id, doc.title]));
  return (
    <Panel title="Verified evidence" action={d.decision ? <Chip tone={d.decision.factSource === "claude" ? "accent" : "neutral"}>{d.decision.factSource === "claude" ? "records + Claude" : "records only"}</Chip> : null}>
      {!d.decision ? (
        <Empty>Not evaluated yet.</Empty>
      ) : (
        <ul className="space-y-3 text-sm">
          {d.decision.facts.map((f) => (
            <li key={f.code}>
              <p>{FACTS[f.code]}</p>
              <p className="mt-0.5 font-mono text-xs text-muted">&ldquo;{f.quote}&rdquo;</p>
              <p className="text-xs text-muted">Source: {f.source === "order_record" ? "order record" : titles.get(f.source)}</p>
            </li>
          ))}
          {d.decision.rejectedFacts.map((r) => (
            <li key={r.code} className="text-xs text-bad">
              Rejected {r.code}: {r.reason}
            </li>
          ))}
          {d.decision.modelIssue ? <li className="text-xs text-warn">{d.decision.modelIssue}</li> : null}
        </ul>
      )}
    </Panel>
  );
}

export function DecisionPanel({ d }: { d: DisputeDetail }) {
  const dec = d.decision;
  if (!dec) return <Panel title="Decision"><Empty>Not evaluated yet.</Empty></Panel>;
  const e = dec.economics;
  const cur = d.row.currency;
  return (
    <Panel title="Decision" action={<Chip tone={dec.action === "challenge" ? "accent" : dec.action === "escalate" ? "warn" : "neutral"}>{dec.action}</Chip>}>
      <div className="space-y-2 text-sm">
        <p>
          <span className="text-muted">Reason:</span> {d.row.reason_code} {dec.assessment.reasonLabel}
        </p>
        <p>
          <span className="text-muted">Evidence:</span> {dec.assessment.strength}, {Math.round(dec.assessment.winProbability * 100)}% estimated win chance
        </p>
        <p>
          <span className="text-muted">Expected loss if accepted:</span> {format(e.acceptLossMinor, cur)}
        </p>
        <p>
          <span className="text-muted">Expected loss if challenged:</span> {format(e.challengeLossMinor, cur)} (including the {format(e.challengeFeeMinor, cur)} fee)
        </p>
        {dec.reasons.map((r) => (
          <p key={r} className="text-xs text-muted">
            {r}
          </p>
        ))}
        {dec.sellerEvidenceRequested.length ? <p className="text-xs text-accent-text">Asked the seller for more evidence and received {dec.sellerEvidenceRequested.length} new document(s).</p> : null}
      </div>
    </Panel>
  );
}
