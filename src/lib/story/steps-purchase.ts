import type { Db } from "../db/client";
import { format } from "../money/money";
import { getPurchase, issueCardForPurchase, simulateCharge, submitPurchase, type CardRow, type PurchaseRow } from "../purchases/agent";
import { PARCELWISE_TERMS } from "../seed";
import { agentCheckout } from "../visa/agent-checkout";
import { skipped, type StepOutcome, type StoryContext, type StoryStep } from "./types";

/** The purchase the story opens with: the Kit 02 scenario on the Purchases page. */
export const STORY_PURCHASE = {
  requester: "Maya Chen",
  vendor: "Parcelwise",
  merchantCategoryCode: "5734",
  purpose: "Shipping label software to cut fulfilment time for marketplace orders",
  termsText: PARCELWISE_TERMS,
  currency: "USD",
};

const usd = (minor: number) => format(minor, "USD");

/** The seller's Parcelwise request to build on: an issued card first, else an approval, else a request still waiting. */
async function latestPurchase(db: Db, tenantId: string): Promise<PurchaseRow | null> {
  const [row] = await db.query<{ id: string }>(
    `SELECT id FROM purchase_requests WHERE tenant_id = $1 AND vendor = $2 AND status IN ('card_issued', 'approved', 'pending_approval')
     ORDER BY CASE status WHEN 'card_issued' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, created_at DESC LIMIT 1`,
    [tenantId, STORY_PURCHASE.vendor],
  );
  return row ? getPurchase(db, row.id) : null;
}

type Card = CardRow & { masked_number: string | null; airwallex_card_id: string; on_behalf_of: string | null };

async function issuedCard(ctx: StoryContext): Promise<{ row: PurchaseRow; card: Card }> {
  const row = await latestPurchase(ctx.app.db, ctx.run.tenant_id);
  if (!row || row.status !== "card_issued") throw new Error("Lumen has no Parcelwise card yet. Run the purchase step first.");
  const [card] = await ctx.app.db.query<Card>("SELECT * FROM cards WHERE purchase_request_id = $1", [row.id]);
  if (!card) throw new Error(`Purchase ${row.id} has no card row`);
  return { row, card };
}

const purchase: StoryStep = {
  id: "purchase",
  title: "Lumen asks to buy Parcelwise",
  promise: "Rules read the cash projection, Claude Sonnet 5.5 weighs the gray areas, and a card is issued for exactly what was approved.",
  async run({ app, run }): Promise<StepOutcome> {
    const { purchases } = app;
    let row = await latestPurchase(purchases.db, run.tenant_id);
    const fresh = !row;
    if (!row) row = await submitPurchase(purchases, { ...STORY_PURCHASE, tenantId: run.tenant_id });
    if (row.status === "approved") row = await issueCardForPurchase(purchases, row.id);
    const href = `/purchases/${row.id}`;
    if (row.status === "pending_approval") {
      return { status: "waiting", narration: `${row.decision.summary} Switch to Priya Shah, decide it on the purchase page, then continue the story.`, href, refs: { purchase: row.id } };
    }
    if (row.status !== "card_issued" || !row.decision.chosen) throw new Error(row.decision.summary || `The purchase ended as ${row.status}.`);
    const [card] = await purchases.db.query<Card>("SELECT * FROM cards WHERE purchase_request_id = $1", [row.id]);
    const chosen = row.decision.chosen;
    const deferred = row.decision.rules?.deferred[0];
    const parts = [
      fresh
        ? `Maya Chen asked for Parcelwise. Rules chose the ${chosen.label.toLowerCase()} at ${format(chosen.chargeMinor, chosen.currency)}.`
        : `Lumen already holds a Parcelwise card from an earlier run, so the story reuses it: rules chose the ${chosen.label.toLowerCase()} at ${format(chosen.chargeMinor, chosen.currency)}.`,
    ];
    if (deferred) parts.push(`The ${deferred.option.label.toLowerCase()} is cheaper over a year but would break Lumen's reserve floor in week ${deferred.firstBreachWeek}, so it is deferred.`);
    if (row.decision.assessment) parts.push(`Claude Sonnet 5.5 read the purpose: ${row.decision.assessment.summary}`);
    parts.push(`Card ${card?.masked_number ?? ""} was issued with a ${format(chosen.chargeMinor, chosen.currency)} limit per charge and per month, one merchant category, no annual price possible.`.replace("  ", " "));
    return { status: "done", narration: parts.join(" "), href, refs: { purchase: row.id, card: card?.airwallex_card_id ?? null } };
  },
};

const failedChecks = (checks: { name: string; pass: boolean }[]) => checks.filter((c) => !c.pass).map((c) => c.name).join(", ") || "none";

const checkout: StoryStep = {
  id: "checkout",
  title: "An agent checks out at Parcelwise",
  promise: "The purchase agent signs its checkout (Visa TAP, RFC 9421). The merchant verifies it, Treza authorizes the card in milliseconds, and a replay and a forgery are refused.",
  async run(ctx): Promise<StepOutcome> {
    const { row, card } = await issuedCard(ctx);
    const { db } = ctx.app;
    const href = `/purchases/${row.id}`;
    const prior = await db.query<{ verified: boolean; n: number }>("SELECT verified, count(*)::int AS n FROM agent_checkouts WHERE card_id = $1 GROUP BY verified", [card.id]);
    const auth = async () =>
      (await db.query<{ response_status: string; latency_ms: number }>("SELECT response_status, latency_ms FROM remote_auth_decisions WHERE card_id = $1 ORDER BY created_at LIMIT 1", [card.id]))[0];
    if (prior.length) {
      const ok = prior.find((p) => p.verified)?.n ?? 0;
      const bad = prior.find((p) => !p.verified)?.n ?? 0;
      const a = await auth();
      return { status: "done", narration: `Already done for this card in an earlier run: ${ok} signed checkout${ok === 1 ? "" : "s"} verified, ${bad} rejected. The first authorization was ${a?.response_status ?? "not recorded"}${a ? ` in ${a.latency_ms} ms` : ""}.`, href, refs: { authorizationMs: a?.latency_ms ?? null } };
    }
    const deps = { purchases: ctx.app.purchases, ...ctx.app.visa };
    const honest = await agentCheckout(deps, row.id, "honest");
    const replay = await agentCheckout(deps, row.id, "replay");
    const forged = await agentCheckout(deps, row.id, "forged");
    const a = await auth();
    const passed = honest.merchantChecks.filter((c) => c.pass).length;
    const parts = [`The agent signed its checkout with its Ed25519 key. Parcelwise verified ${passed} of ${honest.merchantChecks.length} checks.`];
    if (honest.authorization) parts.push(`Treza authorized the card in ${a?.latency_ms ?? "?"} ms against the signed intent (${honest.authorization.status}).`);
    if (honest.charge) parts.push(`The ${usd(row.decision.chosen!.chargeMinor)} charge was ${honest.charge.outcome}${honest.charge.failureReason ? ` (${honest.charge.failureReason})` : ""}.`);
    parts.push(`The identical request sent again was refused (${failedChecks(replay.merchantChecks)}); a forged signature was refused (${failedChecks(forged.merchantChecks)}).`);
    return { status: "done", narration: parts.join(" "), href, refs: { authorizationMs: a?.latency_ms ?? null, charge: honest.charge?.outcome ?? null } };
  },
};

const card: StoryStep = {
  id: "card",
  title: "The card enforces the decision",
  promise: "Three charges the decision did not cover: the annual price, a restaurant, and a second monthly charge. The card network refuses each one.",
  async run(ctx): Promise<StepOutcome> {
    const { row, card } = await issuedCard(ctx);
    const { purchases } = ctx.app;
    if (!purchases.simulator) return skipped("Sandbox card simulation is not configured, so no test charges can be sent.");
    const chosen = row.decision.chosen!;
    const annual = row.options.find((o) => o.billing === "annual");
    const tries = [
      ...(annual ? [{ amountMinor: annual.chargeMinor, mcc: row.merchant_category_code, label: `${row.vendor} annual charge`, why: "The annual price" }] : []),
      { amountMinor: 4_000, mcc: "5812", label: "Restaurant charge", why: "A restaurant" },
      { amountMinor: chosen.chargeMinor, mcc: row.merchant_category_code, label: `${row.vendor} second charge this month`, why: "A second monthly charge" },
    ];
    const lines: string[] = [];
    let accepted = 0;
    for (const t of tries) {
      const [seen] = await purchases.db.query<{ outcome: string; failure_reason: string | null }>(
        "SELECT outcome, failure_reason FROM card_transactions WHERE card_id = $1 AND amount_minor = $2 AND merchant_category_code = $3 AND outcome = 'declined' ORDER BY occurred_at DESC LIMIT 1",
        [card.id, t.amountMinor, t.mcc],
      );
      const r = seen ? { outcome: seen.outcome, failureReason: seen.failure_reason } : await simulateCharge(purchases, card.id, { amountMinor: t.amountMinor, currency: row.currency, merchantCategoryCode: t.mcc, label: t.label });
      if (r.outcome !== "declined") accepted++;
      lines.push(`${t.why} at ${format(t.amountMinor, row.currency)}: ${r.outcome}${r.failureReason ? ` (${r.failureReason})` : ""}`);
    }
    const head = accepted ? `The card let ${accepted} of ${tries.length} charges through that the decision did not cover. Check its controls.` : "The card itself refused everything outside the decision, with no code in the path.";
    return { status: "done", narration: `${head} ${lines.join(". ")}.`, href: `/purchases/${row.id}`, refs: { declined: tries.length - accepted } };
  },
};

export const PURCHASE_STEPS: StoryStep[] = [purchase, checkout, card];
