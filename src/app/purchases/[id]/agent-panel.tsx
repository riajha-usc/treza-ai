import { Chip, Empty, Panel } from "@/components/ui";
import type { PurchaseDetail } from "@/lib/queries/purchases";
import { agentCheckoutAction } from "../actions";

const btn = "rounded-lg border px-3 py-1.5 text-xs font-medium hover:opacity-90";
const MODES = [
  { mode: "honest", label: "Agent checks out", tone: "border-accent-line bg-accent text-accent-text" },
  { mode: "replay", label: "Replay the same request", tone: "border-warn/50 text-warn" },
  { mode: "forged", label: "Forged signature", tone: "border-bad/50 text-bad" },
  { mode: "renewal", label: "Next month's charge", tone: "border-line text-muted" },
  { mode: "overcharge", label: "Merchant tries the annual price", tone: "border-bad/50 text-bad" },
] as const;

function Checks({ checks }: { checks: { name: string; pass: boolean; detail: string }[] }) {
  return (
    <ul className="space-y-1">
      {checks.map((c) => (
        <li key={c.name} className="flex items-start gap-2 text-xs">
          <Chip tone={c.pass ? "good" : "bad"}>{c.pass ? "pass" : "fail"}</Chip>
          <span>
            <span className="text-text">{c.name}</span> <span className="text-muted">{c.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Step 6: Visa TAP signed checkout, VIC-style mandate, and Treza's authorization answer. */
export function AgentPanel({ d }: { d: PurchaseDetail }) {
  if (!d.cards.length) return null;
  const { instruction, checkouts, authorizations } = d.visa;
  const lastCheckout = checkouts[0];
  const lastAuth = authorizations[0];
  return (
    <Panel title="6. Verified agent checkout: Visa TAP and VIC" action={instruction ? <Chip tone="neutral">{instruction.provider}</Chip> : null}>
      <div className="mb-4 flex flex-wrap gap-2">
        {MODES.map((m) => (
          <form key={m.mode} action={agentCheckoutAction}>
            <input type="hidden" name="purchaseId" value={d.row.id} />
            <input type="hidden" name="mode" value={m.mode} />
            <button className={`${btn} ${m.tone}`}>{m.label}</button>
          </form>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-1 text-xs">
          <p className="text-sm">Mandate</p>
          {instruction ? (
            Object.entries(instruction.mandate).map(([k, v]) => (
              <p key={k}>
                <span className="text-muted">{k}:</span> {typeof v === "object" ? JSON.stringify(v) : String(v)}
              </p>
            ))
          ) : (
            <Empty>Created at the first agent checkout.</Empty>
          )}
        </div>
        <div>
          <p className="mb-1 text-sm">
            Merchant verification {lastCheckout ? <Chip tone={lastCheckout.verified ? "good" : "bad"}>{lastCheckout.verified ? "accepted" : "rejected"}</Chip> : null}
          </p>
          {lastCheckout ? <Checks checks={lastCheckout.checks} /> : <Empty>No checkout yet.</Empty>}
        </div>
        <div>
          <p className="mb-1 text-sm">
            Card authorization {lastAuth ? <Chip tone={lastAuth.response_status === "AUTHORIZED" ? "good" : "bad"}>{lastAuth.response_status}</Chip> : null}
          </p>
          {lastAuth ? (
            <>
              <p className="mb-1 text-xs text-muted">
                {lastAuth.status_reason} · answered in {lastAuth.latency_ms} ms
              </p>
              <Checks checks={lastAuth.checks} />
            </>
          ) : (
            <Empty>No authorization yet.</Empty>
          )}
        </div>
      </div>
    </Panel>
  );
}
