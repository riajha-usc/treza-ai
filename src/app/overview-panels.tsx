import { dateTime } from "@/components/time";
import { Empty, Facts, Panel, PanelNote, Tag } from "@/components/ui";
import { format } from "@/lib/money/money";
import type { loadOverview } from "@/lib/queries/overview";

export const usd = (minor: number) => format(minor, "USD");
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The right-hand column: how the loop connects, whether the ledger holds, and what the models did. */
export function OverviewSide({ o }: { o: Awaited<ReturnType<typeof loadOverview>> }) {
  const f = o.figures;
  return (
    <div className="flex flex-col gap-4 xl:w-[360px] xl:flex-none">
      <Panel title="Control loop">
        <ol className="flex flex-col p-4">
          <Stage title="Spend" detail={`${plural(f.activeCards, "active card")} · ${plural(f.declines, "decline")}`} link="Risk tier changes tighten card limits" />
          <Stage title="Settle" detail={`${plural(f.sellersPaid, "seller")} paid · ${usd(f.heldMinor)} held`} link="Open disputes raise the seller's reserve" />
          <Stage title="Defend" detail={`${f.disputesSubmitted} submitted · ${f.disputesAwaiting} awaiting approval`} link="Signed purchase intent becomes evidence" />
          <li className="flex gap-3">
            <span aria-hidden className="mt-1 size-2.5 flex-none rounded-[2px] bg-ink" />
            <div>
              <b className="font-semibold">Ledger</b>
              <p className="text-muted">One double-entry ledger for all three</p>
            </div>
          </li>
        </ol>
      </Panel>

      <Panel title="Ledger integrity" meta={<Tag tone={o.ledger.imbalanceMinor === 0 ? "good" : "bad"}>{o.ledger.imbalanceMinor === 0 ? "Balanced" : "Unbalanced"}</Tag>}>
        <Facts
          rows={[
            ["Journal entries", o.ledger.entries.toLocaleString("en-US")],
            ["Debits less credits", usd(o.ledger.imbalanceMinor)],
            ["Last reconciliation", o.ledger.reconciliation ? dateTime(o.ledger.reconciliation.created_at) : "Not run yet"],
            ["Wallet vs ledger", o.ledger.reconciliation ? <span className={o.ledger.reconciliation.ok ? "text-good" : "text-bad"}>{o.ledger.reconciliation.ok ? "Matched" : "Needs attention"}</span> : "n/a"],
            ["Edits or deletes", "Blocked by the database"],
          ]}
        />
      </Panel>

      <Panel title="Model usage">
        {o.models.length === 0 ? (
          <Empty>No model calls yet.</Empty>
        ) : (
          <Facts rows={o.models.map((m) => [m.model, `${plural(m.calls, "call")}${m.median_ms != null ? ` · ${(m.median_ms / 1000).toFixed(1)} s median` : ""}`])} />
        )}
        <PanelNote>Models read documents and recommend. Only code and people can move money.</PanelNote>
      </Panel>
    </div>
  );
}

function Stage({ title, detail, link }: { title: string; detail: string; link: string }) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span aria-hidden className="mt-1 size-2.5 rounded-full bg-primary" />
        <span aria-hidden className="w-px flex-1 bg-line-strong" />
      </div>
      <div className="pb-3.5">
        <b className="font-semibold">{title}</b>
        <p className="text-muted">{detail}</p>
        <p className="mt-1.5 text-xs text-ink-2">{link}</p>
      </div>
    </li>
  );
}
