import { Chip, Empty, Panel } from "@/components/ui";
import { format } from "@/lib/money/money";
import type { PurchaseDetail } from "@/lib/queries/purchases";
import { freezeCardAction, issueCardAction, simulateChargeAction } from "../actions";

const btn = "rounded-lg border px-3 py-1.5 text-xs font-medium hover:opacity-90";

/** Step 5: the card enforces the decision, and sandbox charges prove it. */
export function CardPanel({ d }: { d: PurchaseDetail }) {
  const { row } = d;
  const dec = row.decision;
  const chosen = dec.chosen;
  const annual = row.options.find((o) => o.billing === "annual");
  return (
    <Panel title="5. Card enforces the decision">
      {dec.controls ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-muted">Uses:</span> {dec.controls.allowed_transaction_count === "SINGLE" ? "single charge" : "recurring"}
            </p>
            {dec.controls.transaction_limits.limits.map((l) => (
              <p key={l.interval}>
                <span className="text-muted">{l.interval.replace("_", " ").toLowerCase()} limit:</span> ${l.amount.toFixed(2)}
              </p>
            ))}
            <p>
              <span className="text-muted">Merchant category:</span> {dec.controls.allowed_merchant_categories.join(", ")}
            </p>
            <p>
              <span className="text-muted">Valid until:</span> {new Date(dec.controls.active_to).toLocaleDateString()}
            </p>
            <p>
              <span className="text-muted">Issued on:</span>{" "}
              {d.connectedAccount ? `connected account ${d.connectedAccount}` : "platform account (connected account pending platform access)"}
            </p>
            {dec.issuanceNote ? <p className="text-xs text-warn">{dec.issuanceNote}</p> : null}
          </div>
          <div>
            {d.cards.map((card) => (
              <div key={card.id} className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs">{card.masked_number ?? card.airwallex_card_id}</span>
                  <Chip tone={card.status === "ACTIVE" ? "good" : "warn"}>{card.status}</Chip>
                </div>
                {d.canSimulate && chosen ? (
                  <div className="flex flex-wrap gap-2">
                    <ChargeButton purchaseId={row.id} cardId={card.id} amountMinor={chosen.chargeMinor} mcc={row.merchant_category_code} label={`${row.vendor} ${chosen.billing} charge`} text={`Charge ${format(chosen.chargeMinor, chosen.currency)}`} />
                    {annual && annual.id !== chosen.id ? (
                      <ChargeButton purchaseId={row.id} cardId={card.id} amountMinor={annual.chargeMinor} mcc={row.merchant_category_code} label={`${row.vendor} annual charge`} text={`Try annual ${format(annual.chargeMinor, annual.currency)}`} />
                    ) : null}
                    <ChargeButton purchaseId={row.id} cardId={card.id} amountMinor={4_000} mcc="5812" label="Restaurant charge" text="Try a restaurant" />
                    <form action={freezeCardAction}>
                      <input type="hidden" name="purchaseId" value={row.id} />
                      <input type="hidden" name="cardId" value={card.id} />
                      <input type="hidden" name="frozen" value={card.status === "ACTIVE" ? "true" : "false"} />
                      <button className={`${btn} border-line text-muted`}>{card.status === "ACTIVE" ? "Freeze card" : "Unfreeze card"}</button>
                    </form>
                  </div>
                ) : null}
              </div>
            ))}
            {d.cards.length === 0 && row.status === "approved" && d.canIssue ? (
              <form action={issueCardAction}>
                <input type="hidden" name="purchaseId" value={row.id} />
                <button className={`${btn} border-accent-line bg-accent text-accent-text`}>Issue card now</button>
              </form>
            ) : null}
            {d.cards.length === 0 && !d.canIssue ? <Empty>Add Airwallex sandbox keys to issue the card.</Empty> : null}
            {d.transactions.length > 0 ? (
              <ul className="mt-4 divide-y divide-line text-sm">
                {d.transactions.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="text-muted">{t.merchant_name}</span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{format(t.amount_minor, t.currency)}</span>
                      <Chip tone={t.outcome === "accepted" ? "good" : "bad"}>{t.failure_reason ?? t.outcome}</Chip>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : (
        <Empty>No card: this request was not approved.</Empty>
      )}
    </Panel>
  );
}

function ChargeButton(p: { purchaseId: string; cardId: string; amountMinor: number; mcc: string; label: string; text: string }) {
  return (
    <form action={simulateChargeAction}>
      <input type="hidden" name="purchaseId" value={p.purchaseId} />
      <input type="hidden" name="cardId" value={p.cardId} />
      <input type="hidden" name="amountMinor" value={p.amountMinor} />
      <input type="hidden" name="mcc" value={p.mcc} />
      <input type="hidden" name="label" value={p.label} />
      <button className={`${btn} border-accent-line/60 text-accent-text`}>{p.text}</button>
    </form>
  );
}
