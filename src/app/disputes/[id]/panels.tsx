import { Empty, Facts, Panel, PanelNote, Tag } from "@/components/ui";
import { FACTS } from "@/lib/disputes/facts";
import { format } from "@/lib/money/money";
import type { DisputeDetail } from "@/lib/queries/disputes";
import { ACTION_TAG } from "../tags";

/** Facts the evidence rests on, each with the exact words it was found in. */
export function EvidencePanel({ d }: { d: DisputeDetail }) {
  const titles = new Map(d.documents.map((doc) => [doc.id, doc.title]));
  const dec = d.decision;
  return (
    <Panel title="Verified evidence" meta={dec ? <Tag tone={dec.factSource === "claude" ? "info" : "neutral"}>{dec.factSource === "claude" ? "Records and Claude Opus 5.5" : "Records only"}</Tag> : null}>
      {!dec ? (
        <Empty>Not evaluated yet.</Empty>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Fact</th><th>Quoted from the source</th><th>Source</th></tr></thead>
              <tbody>
                {dec.facts.map((f) => (
                  <tr key={f.code}>
                    <td>{FACTS[f.code]}</td>
                    <td className="font-mono text-xs text-ink-2">&ldquo;{f.quote}&rdquo;</td>
                    <td className="text-muted">{f.source === "order_record" ? "Order record" : titles.get(f.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(dec.flaggedDocs ?? []).map((f) => (
            <PanelNote key={f.id}>
              <span className="text-warn">
                {titles.get(f.id) ?? f.id} contains instructions aimed at the reviewer (&ldquo;{f.phrase}&rdquo;). Treated as data, not evidence, and left out of what is sent.
              </span>
            </PanelNote>
          ))}
          {dec.rejectedFacts.map((r) => (
            <PanelNote key={r.code}>
              <span className="text-bad">Rejected {r.code}: {r.reason}</span>
            </PanelNote>
          ))}
          {dec.modelIssue ? (
            <PanelNote>
              <span className="text-warn">{dec.modelIssue}</span>
            </PanelNote>
          ) : null}
        </>
      )}
    </Panel>
  );
}

export function DecisionPanel({ d }: { d: DisputeDetail }) {
  const dec = d.decision;
  if (!dec) return null;
  const e = dec.economics;
  const cur = d.row.currency;
  const [tone, label] = ACTION_TAG[dec.action];
  return (
    <Panel title="Decision" meta={<Tag tone={tone}>{label}</Tag>}>
      <Facts
        rows={[
          ["Reason code", `${d.row.reason_code} ${dec.assessment.reasonLabel}`],
          ["Evidence strength", <span key="s" className="capitalize">{dec.assessment.strength}</span>],
          ["Estimated win chance", `${Math.round(dec.assessment.winProbability * 100)}%`],
          ["Expected loss if accepted", format(e.acceptLossMinor, cur)],
          ["Expected loss if challenged", `${format(e.challengeLossMinor, cur)} incl. ${format(e.challengeFeeMinor, cur)} fee`],
        ]}
      />
      {dec.reasons.map((r) => (
        <PanelNote key={r}>{r}</PanelNote>
      ))}
      {dec.sellerEvidenceRequested.length ? <PanelNote>Asked the seller for more evidence and received {dec.sellerEvidenceRequested.length} new document(s).</PanelNote> : null}
    </Panel>
  );
}
