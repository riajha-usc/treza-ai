import type { ReactNode } from "react";
import { date } from "@/components/time";
import { Empty, Facts, Panel, PanelBody, PanelNote, Tag } from "@/components/ui";
import { format } from "@/lib/money/money";
import { categoryName } from "@/lib/purchases/merchant-categories";
import type { PurchaseDetail } from "@/lib/queries/purchases";
import { freezeCardAction, issueCardAction, simulateChargeAction } from "../actions";

/** "************5255" reads as "•••• 5255". */
const masked = (n: string | null) => (n ? `•••• ${n.slice(-4)}` : null);

const INTERVAL = { PER_TRANSACTION: "Per charge", MONTHLY: "Monthly limit", ALL_TIME: "Lifetime limit" } as const;

/** The card's controls are the decision, enforced by the card network. */
export function CardPanel({ d }: { d: PurchaseDetail }) {
  const { row } = d;
  const controls = row.decision.controls;
  const card = d.cards[0];
  const canIssue = !card && (row.status === "approved" || (row.status === "failed" && controls)) && d.canIssue;
  return (
    <Panel title="Card controls" meta={card ? <span className="font-mono text-xs">{masked(card.masked_number) ?? card.airwallex_card_id.slice(0, 8)}</span> : null}>
      {!controls ? (
        <Empty>No card: this request was not approved.</Empty>
      ) : (
        <>
          <Facts
            rows={[
              ...(card ? [["Status", <Tag key="s" tone={card.status === "ACTIVE" ? "good" : "warn"}>{card.status === "ACTIVE" ? "Active" : card.status.toLowerCase()}</Tag>] as [string, ReactNode]] : []),
              ...controls.transaction_limits.limits.map((l) => [INTERVAL[l.interval], format(Math.round(l.amount * 100), controls.transaction_limits.currency)] as [string, string]),
              ["Uses", controls.allowed_transaction_count === "SINGLE" ? "Single charge" : "Recurring"],
              ["Merchant category", controls.allowed_merchant_categories.map((c) => `${c} ${categoryName(c)}`).join(", ")],
              ["Valid until", date(controls.active_to)],
              ["Issued on", d.connectedAccount ? "Seller's connected account" : "Platform account"],
              ...(row.fingerprint ? [["Terms fingerprint", <span key="f" className="font-mono text-xs">{row.fingerprint.slice(0, 4)}…{row.fingerprint.slice(-4)}</span>] as [string, ReactNode]] : []),
            ]}
          />
          {row.decision.issuanceNote && !card ? (
            <PanelNote>
              <span className="text-warn">{row.decision.issuanceNote}</span>
            </PanelNote>
          ) : null}
          {canIssue ? (
            <PanelBody className="border-t border-line">
              <form action={issueCardAction}>
                <input type="hidden" name="purchaseId" value={row.id} />
                <button className="btn btn-primary">Issue card now</button>
              </form>
            </PanelBody>
          ) : null}
          {!card && !d.canIssue ? <PanelNote>Add Airwallex sandbox keys to issue the card.</PanelNote> : null}
        </>
      )}
    </Panel>
  );
}

/** Real sandbox charges against the card, plus test charges that prove the controls hold. */
export function TransactionsPanel({ d }: { d: PurchaseDetail }) {
  const { row } = d;
  const card = d.cards[0];
  if (!card) return null;
  const chosen = row.decision.chosen;
  const annual = row.options.find((o) => o.billing === "annual");
  return (
    <Panel title="Card transactions">
      {d.transactions.length === 0 ? (
        <Empty>No charges yet.</Empty>
      ) : (
        <table className="tbl">
          <tbody>
            {d.transactions.map((t) => (
              <tr key={t.id}>
                <td>{t.merchant_name}</td>
                <td className="num">{format(t.amount_minor, t.currency)}</td>
                <td className="num">
                  <Tag tone={t.outcome === "accepted" ? "good" : t.outcome === "declined" ? "bad" : "neutral"}>{t.outcome === "accepted" ? "Cleared" : (t.failure_reason ?? t.outcome).replaceAll("_", " ").toLowerCase()}</Tag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d.canSimulate && chosen ? (
        <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
          <span className="text-xs text-muted">Test charges</span>
          <div className="flex flex-wrap gap-1.5">
            <ChargeButton d={d} amountMinor={chosen.chargeMinor} mcc={row.merchant_category_code} label={`${row.vendor} ${chosen.billing} charge`} text={`Charge ${format(chosen.chargeMinor, chosen.currency)}`} />
            {annual && annual.id !== chosen.id ? (
              <ChargeButton d={d} amountMinor={annual.chargeMinor} mcc={row.merchant_category_code} label={`${row.vendor} annual charge`} text="Annual price" />
            ) : null}
            <ChargeButton d={d} amountMinor={4_000} mcc="5812" label="Restaurant charge" text="Restaurant" />
            <form action={freezeCardAction}>
              <input type="hidden" name="purchaseId" value={row.id} />
              <input type="hidden" name="cardId" value={card.id} />
              <input type="hidden" name="frozen" value={card.status === "ACTIVE" ? "true" : "false"} />
              <button className="btn btn-sm">{card.status === "ACTIVE" ? "Freeze card" : "Unfreeze card"}</button>
            </form>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function ChargeButton({ d, amountMinor, mcc, label, text }: { d: PurchaseDetail; amountMinor: number; mcc: string; label: string; text: string }) {
  return (
    <form action={simulateChargeAction}>
      <input type="hidden" name="purchaseId" value={d.row.id} />
      <input type="hidden" name="cardId" value={d.cards[0].id} />
      <input type="hidden" name="amountMinor" value={amountMinor} />
      <input type="hidden" name="mcc" value={mcc} />
      <input type="hidden" name="label" value={label} />
      <button className="btn btn-sm">{text}</button>
    </form>
  );
}
