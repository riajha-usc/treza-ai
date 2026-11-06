import { AirwallexError } from "../airwallex/client";
import type { Db } from "../db/client";
import { stageDemoDisputes } from "../disputes/pipeline";
import { format } from "../money/money";
import { loadPolicy, loadRiskTier, RISK_CAP_MULTIPLIER } from "../purchases/policy";
import { decideBridges, DEFAULT_BRIDGE_POLICY, repayFundedBridges, requestBridge } from "../settlement/bridging";
import { runSettlementCycle, TAKE_RATE_BPS } from "../settlement/cycle";
import { DEMO_BRIDGE_REQUESTS, DEMO_CARRIER_FAILURE, DEMO_CYCLE_SALES } from "../settlement/demo";
import { sellers } from "../settlement/deps";
import { reportCarrierFailure } from "../settlement/exposure";
import { onboardSellers } from "../settlement/onboard";
import { reconcileCycle } from "../settlement/reconcile";
import { skipped, type StepOutcome, type StoryStep } from "./types";

const usd = (minor: number) => format(Number(minor), "USD");
const NO_PLATFORM = "Airwallex platform access is not configured, so there is no wallet to pay sellers from.";
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** A cycle id that is unique even when two runs settle within the same minute. */
async function newCycleId(db: Db): Promise<string> {
  const base = `cycle_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
  for (let n = 0; ; n++) {
    const id = n ? `${base}_${n}` : base;
    if (!(await db.query("SELECT 1 FROM settlement_cycles WHERE id = $1", [id])).length) return id;
  }
}

const latestCycle = async (db: Db) => (await db.query<{ id: string }>("SELECT id FROM settlement_cycles WHERE status = 'settled' ORDER BY created_at DESC LIMIT 1"))[0]?.id ?? null;
const reconciled = (r: { ok: boolean; findings: string[] }) => (r.ok ? "the wallet moved exactly what the ledger says" : `reconciliation found ${r.findings.join("; ")}`);

const settle: StoryStep = {
  id: "settle",
  title: "Payday",
  promise: "Buyer payments land, every seller is paid out with its reserve held for a stated reason, and the wallet is reconciled against the ledger.",
  async run({ app, run }): Promise<StepOutcome> {
    const { settlement, db } = app;
    if (!settlement.gateway) return skipped(NO_PLATFORM);
    const seller = (await sellers(db)).find((s) => s.id === run.tenant_id);
    if (!seller) throw new Error(`Unknown seller ${run.tenant_id}`);
    if (!seller.airwallex_account_id) await onboardSellers(settlement);
    let [cycle] = await db.query<{ id: string }>("SELECT id FROM settlement_cycles WHERE status = 'settled' AND created_at >= $1 ORDER BY created_at DESC LIMIT 1", [run.created_at]);
    let recon: { ok: boolean; findings: string[] };
    if (cycle) {
      recon = (await db.query<{ ok: boolean; findings: string[] }>("SELECT ok, findings FROM reconciliation_runs ORDER BY created_at DESC LIMIT 1"))[0] ?? { ok: false, findings: ["not run"] };
    } else {
      const id = await newCycleId(db);
      await runSettlementCycle(settlement, id, DEMO_CYCLE_SALES);
      recon = await reconcileCycle(settlement, id);
      cycle = { id };
    }
    const [line] = await db.query<{ gross_minor: number; reserve_rate_bps: number; reserve_target_minor: number; reserve_change_minor: number; payout_minor: number; explanation: string[]; transfer_id: string | null; transfer_status: string | null }>(
      "SELECT * FROM settlement_lines WHERE cycle_id = $1 AND tenant_id = $2",
      [cycle.id, seller.id],
    );
    if (!line) throw new Error(`Cycle ${cycle.id} has no settlement line for ${seller.name}`);
    const paid = line.transfer_id ? `paid by transfer ${line.transfer_id} (${line.transfer_status})` : "credited in the ledger; the seller has no connected account to receive it yet";
    const change = Number(line.reserve_change_minor);
    const held = change > 0 ? `${usd(change)} more was held this cycle` : change < 0 ? `${usd(-change)} was released` : "nothing more had to be held";
    const narration = `Cycle ${cycle.id}: ${seller.name} sold ${usd(line.gross_minor)} and paid the ${TAKE_RATE_BPS / 100}% platform fee. Its reserve target is ${usd(line.reserve_target_minor)}, ${(line.reserve_rate_bps / 100).toFixed(2)}% of sales (${line.explanation.map(lower).join("; ")}), so ${held}. Payout ${usd(line.payout_minor)}, ${paid}. Reconciliation: ${reconciled(recon)}.`;
    return { status: "done", narration, href: "/sellers", refs: { cycle: cycle.id, transfer: line.transfer_id, reserveRate: `${(line.reserve_rate_bps / 100).toFixed(2)}%` } };
  },
};

const carrier: StoryStep = {
  id: "carrier",
  title: "A carrier fails",
  promise: "After payout, a carrier loses a batch of Lumen's parcels. Only Lumen's exposure is recalculated, the shortfall is charged from its wallet, and its risk tier rises.",
  async run({ app, run }): Promise<StepOutcome> {
    const { settlement, db } = app;
    if (!settlement.gateway) return skipped(NO_PLATFORM);
    const f = DEMO_CARRIER_FAILURE;
    // One failure is the story. Reporting it again on every rerun would stack risk signals until Lumen is restricted.
    const find = () =>
      db.query<{ id: string; resolution: { exposureMinor: number; targetMinor: number; shortfallMinor: number; chargedMinor: number; owedMinor: number } }>(
        "SELECT id, resolution FROM exposure_events WHERE tenant_id = $1 AND kind = 'carrier_failure' ORDER BY created_at DESC LIMIT 1",
        [run.tenant_id],
      );
    const before = await loadRiskTier(db, run.tenant_id);
    let [ev] = await find();
    const fresh = !ev;
    if (!ev) {
      await reportCarrierFailure(settlement, { ...f, tenantId: run.tenant_id });
      [ev] = await find();
    }
    const r = ev.resolution;
    const [op] = await db.query<{ response: { id?: string } | null }>("SELECT response FROM outbound_requests WHERE op_key = $1 AND status = 'succeeded'", [`recover:${ev.id}`]);
    const chargeId = op?.response?.id ?? null;
    const after = await loadRiskTier(db, run.tenant_id);
    const parts = [
      `${fresh ? "" : "Reported in an earlier run: "}${f.carrier} lost ${f.undeliveredOrders} of Lumen's parcels and ${usd(f.refundsRequestedMinor)} in refund requests arrived after payout.`,
      `Exposure ${usd(r.exposureMinor)}; reserve target raised to ${usd(r.targetMinor)}.`,
      r.chargedMinor > 0 ? `The ${usd(r.chargedMinor)} shortfall was charged from Lumen's wallet${chargeId ? ` (${chargeId})` : ""}.` : "Lumen's wallet could not cover the shortfall.",
    ];
    if (r.owedMinor > 0) parts.push(`${usd(r.owedMinor)} is owed and nets from the next payout.`);
    parts.push(fresh && before.tier !== after.tier ? `Risk tier: ${before.tier} to ${after.tier}.` : `Risk tier stays ${after.tier}.`);
    return { status: "done", narration: parts.join(" "), href: "/sellers", refs: { charge: chargeId, exposure: usd(r.exposureMinor), tier: after.tier } };
  },
};

const loop: StoryStep = {
  id: "loop",
  title: "The loop closes",
  promise: "No money moves in this step. The settlement agent's risk tier changes what the purchase agent may approve for Lumen, with no person editing a policy.",
  async run({ app, run }): Promise<StepOutcome> {
    const policy = await loadPolicy(app.db, run.tenant_id);
    const risk = await loadRiskTier(app.db, run.tenant_id);
    if (!policy) throw new Error(`${run.tenant_id} has no spend policy`);
    const mult = RISK_CAP_MULTIPLIER[risk.tier];
    const cap = Math.floor(policy.maxChargeMinor * mult);
    const refs = { tier: risk.tier, capBefore: usd(policy.maxChargeMinor), capAfter: usd(cap) };
    if (mult === 1) return { status: "done", narration: `Lumen's risk tier is still low, so the purchase agent's ceiling stays at ${usd(policy.maxChargeMinor)}. Nothing upstream changed Lumen's risk, so nothing changed its spending.`, href: "/policies", refs };
    const why = risk.reasons.at(-1) ? ` (${risk.reasons.at(-1)})` : "";
    return {
      status: "done",
      narration: `Lumen's risk tier is ${risk.tier}${why}. The purchase agent now caps any new card at ${usd(cap)} instead of ${usd(policy.maxChargeMinor)}, ${Math.round(mult * 100)}% of policy; cards already issued keep their limits. The settlement agent changed what the purchase agent may approve, and nobody edited a policy. That is the loop.`,
      href: "/policies",
      refs,
    };
  },
};

const bridge: StoryStep = {
  id: "bridge",
  title: "Cash gets tight",
  promise: "Three sellers ask for bridges against one facility that never lends against reserves. Rules fund what the free capital allows and defer the rest, with reasons.",
  async run({ app, run }): Promise<StepOutcome> {
    const { settlement, db } = app;
    if (!settlement.gateway) return skipped(NO_PLATFORM);
    const find = () =>
      db.query<{ name: string; amount_minor: number; status: string; decision: { reason?: string }; transfer_id: string | null }>(
        "SELECT t.name, b.amount_minor, b.status, b.decision, b.transfer_id FROM bridges b JOIN tenants t ON t.id = b.tenant_id WHERE b.created_at >= $1 ORDER BY b.created_at",
        [run.created_at],
      );
    let rows = await find();
    if (!rows.length) {
      for (const r of DEMO_BRIDGE_REQUESTS) await requestBridge(settlement, r);
      await decideBridges(settlement);
      rows = await find();
    }
    const funded = rows.filter((b) => b.status === "funded" || b.status === "repaid");
    const narration = `${["No", "One", "Two", "Three"][rows.length] ?? rows.length} seller${rows.length === 1 ? "" : "s"} asked for bridges against the ${usd(DEFAULT_BRIDGE_POLICY.facilityMinor)} facility. ${rows.map((b) => `${b.name} ${usd(b.amount_minor)}: ${b.status}. ${b.decision.reason ?? "No reason recorded"}`).join(". ")}.`;
    return { status: "done", narration, href: "/sellers", refs: { funded: funded.length, transfers: funded.map((b) => b.transfer_id).filter(Boolean).join(", ") || null } };
  },
};

const deposits: StoryStep = {
  id: "deposits",
  title: "Late deposits land",
  promise: "The late deposits arrive, every funded bridge is charged back after a wallet check, and the wallet is reconciled again.",
  async run({ app, run }): Promise<StepOutcome> {
    const { settlement, db } = app;
    if (!settlement.gateway) return skipped(NO_PLATFORM);
    const [{ n }] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM bridges WHERE status = 'funded'");
    let log: string[];
    if (n > 0) log = await repayFundedBridges(settlement, 300_000);
    else {
      const repaid = await db.query<{ name: string; amount_minor: number; repay_charge_id: string | null }>(
        "SELECT t.name, b.amount_minor, b.repay_charge_id FROM bridges b JOIN tenants t ON t.id = b.tenant_id WHERE b.status = 'repaid' AND b.updated_at >= $1",
        [run.created_at],
      );
      if (!repaid.length) return skipped("No bridge was funded in this run, so there is nothing to charge back.");
      log = repaid.map((b) => `${b.name} repaid ${usd(b.amount_minor)} earlier in this run${b.repay_charge_id ? ` (${b.repay_charge_id})` : ""}`);
    }
    const cycle = await latestCycle(db);
    const recon = cycle ? await reconcileCycle(settlement, cycle) : { ok: false, findings: ["no settled cycle"] };
    const [{ left }] = await db.query<{ left: number }>("SELECT COALESCE(SUM(amount_minor), 0)::bigint AS left FROM bridges WHERE status = 'funded'");
    return { status: "done", narration: `${log.join(". ")}. Facility outstanding ${usd(left)}. Reconciliation: ${reconciled(recon)}.`, href: "/reconciliation", refs: { outstanding: usd(left) } };
  },
};

const dispute: StoryStep = {
  id: "dispute",
  title: "A chargeback arrives",
  promise: "Four chargebacks reach three sellers. Claude Opus 5.5 compiles the evidence, code verifies every quote, a weak case is accepted, and a refund Treza issued proves itself.",
  async run({ app }): Promise<StepOutcome> {
    const { disputes, db } = app;
    if (!disputes.gateway || !disputes.simulator) return skipped("Sandbox payment simulation is not configured, so no chargeback can be staged.");
    try {
      await stageDemoDisputes(disputes);
    } catch (e) {
      if (!(e instanceof AirwallexError)) throw e;
      return skipped(`The sandbox refused to take the buyer's payment (${e.message}). Online payments must be enabled on this account first; Airwallex enables it on request. The dispute pages show the same agent on earlier cases.`);
    }
    const rows = await db.query<{ order_id: string; reason_code: string; status: string; amount_minor: number; action: string | null; name: string }>(
      "SELECT d.order_id, d.reason_code, d.status, d.amount_minor, d.decision->>'action' AS action, t.name FROM disputes d JOIN tenants t ON t.id = d.seller_tenant_id ORDER BY d.order_id",
    );
    if (!rows.length) return skipped("The sandbox accepted the payments but no dispute came back yet. Open Disputes and sync again in a minute.");
    const [{ ignored }] = await db.query<{ ignored: number }>("SELECT count(*)::int AS ignored FROM audit_log WHERE action = 'dispute.instructions_ignored'");
    const tail = ignored ? " One seller note told the reviewer what to do; code flagged it and the agent did not treat it as evidence." : "";
    return { status: "done", narration: `${rows.map((r) => `${r.name} ${r.order_id} ${usd(r.amount_minor)} (${r.reason_code}): ${r.action ?? "pending"}, now ${r.status}`).join("; ")}.${tail}`, href: "/disputes", refs: { disputes: rows.length } };
  },
};

export const SETTLEMENT_STEPS: StoryStep[] = [settle, carrier, loop, bridge, deposits, dispute];
