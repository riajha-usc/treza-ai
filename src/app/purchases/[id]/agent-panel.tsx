import { Facts, Panel, Tag } from "@/components/ui";
import type { PurchaseDetail } from "@/lib/queries/purchases";
import { agentCheckoutAction } from "../actions";

const MODES = [
  { mode: "honest", label: "Agent checks out", primary: true },
  { mode: "replay", label: "Replay request" },
  { mode: "forged", label: "Forged signature" },
  { mode: "renewal", label: "Next month" },
  { mode: "overcharge", label: "Over mandate" },
] as const;

type Check = { name: string; pass: boolean; detail: string };

function Checks({ title, checks }: { title: string; checks: Check[] }) {
  return (
    <details className="border-t border-line px-4 py-2.5">
      <summary className="cursor-pointer text-xs text-muted">
        {title}: {checks.filter((c) => c.pass).length} of {checks.length} passed
      </summary>
      <ul className="mt-2 flex flex-col gap-1.5">
        {checks.map((c) => (
          <li key={c.name} className="flex items-start gap-2 text-xs">
            <Tag tone={c.pass ? "good" : "bad"}>{c.pass ? "Pass" : "Fail"}</Tag>
            <span>
              {c.name} <span className="text-muted">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Visa TAP signed checkout, the VIC-style mandate, and Treza's answer to Airwallex. */
export function AgentPanel({ d }: { d: PurchaseDetail }) {
  if (!d.cards.length) return null;
  const { instruction, checkouts, authorizations } = d.visa;
  const checkout = checkouts[0];
  const auth = authorizations[0];
  const passed = checkout ? checkout.checks.filter((c) => c.pass).length : 0;
  return (
    <Panel title="Agent checkout" meta={checkout ? <Tag tone={checkout.verified ? "good" : "bad"}>{checkout.verified ? "Verified" : "Rejected"}</Tag> : null}>
      <Facts
        rows={[
          ["Protocol", "Visa Trusted Agent Protocol"],
          ["Signature", "Ed25519 · agent-payer-auth"],
          ["Mandate", instruction ? instruction.provider : "Created at first checkout"],
          ["Merchant checks", checkout ? `${passed} of ${checkout.checks.length} passed` : "No checkout yet"],
          ["Authorization", auth ? <span key="a" className={auth.response_status === "AUTHORIZED" ? "text-good" : "text-bad"}>{auth.response_status === "AUTHORIZED" ? "Approved" : "Declined"} in {auth.latency_ms} ms</span> : "None yet"],
        ]}
      />
      {auth ? <div className="border-t border-line px-4 py-2.5 text-xs text-muted">{auth.status_reason}</div> : null}
      {checkout ? <Checks title="Merchant verification" checks={checkout.checks} /> : null}
      {auth ? <Checks title="Authorization checks" checks={auth.checks} /> : null}
      <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
        <span className="text-xs text-muted">Test scenarios</span>
        <div className="flex flex-wrap gap-1.5">
          {MODES.map((m) => (
            <form key={m.mode} action={agentCheckoutAction}>
              <input type="hidden" name="purchaseId" value={d.row.id} />
              <input type="hidden" name="mode" value={m.mode} />
              <button className={`btn btn-sm ${"primary" in m ? "btn-primary" : ""}`}>{m.label}</button>
            </form>
          ))}
        </div>
      </div>
    </Panel>
  );
}
