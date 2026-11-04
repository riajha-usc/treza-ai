import { FakeDisputeModel } from "../../tests/dispute-fakes";
import { testDb, type Db } from "../../src/lib/db/client";
import { evaluateDispute, ingestDispute, type DisputeDeps } from "../../src/lib/disputes/agent";
import { assessEvidence, decide, DEFAULT_DISPUTE_POLICY } from "../../src/lib/disputes/assess";
import type { Fact, FactCode } from "../../src/lib/disputes/facts";
import { ensureTenant } from "../../src/lib/ledger/ledger";
import type { DisputeModel } from "../../src/lib/models/dispute-model";
import { seedDemo } from "../../src/lib/seed";
import { DISPUTE_CASES, type DisputeCase } from "../sets/disputes";
import { pct, type Section } from "./report";

const ADDRESS = "18 Alder Way, Portland, OR 97205";

async function stage(db: Db, c: DisputeCase) {
  const email = `${c.id}@example.com`;
  const insert = (id: string, device: string, ip: string, delivered: boolean, signedBy: string | null, toBilling: boolean, amount: number, intent: string | null, createdAt: string) =>
    db.query(
      `INSERT INTO orders (id, seller_tenant_id, buyer_name, buyer_email, amount_minor, currency, device_fingerprint, ip_address, billing_address, shipping_address,
         carrier, tracking_number, shipped_at, delivered_at, signed_by, created_at, payment_intent_id)
       VALUES ($1, $2, 'Eval Buyer', $3, $4, 'USD', $5, $6, $7, $8, 'UPS', $9, '2026-10-12T16:00:00Z', $10, $11, $12, $13)`,
      [id, c.seller, email, Math.round(amount * 100), device, ip, ADDRESS, toBilling ? ADDRESS : "9 Other Street, Salem, OR 97301", `1Z${id}`, delivered ? "2026-10-15T21:14:00Z" : null, signedBy, createdAt, intent],
    );
  const prior = c.prior ?? { device: 0, ip: 0 };
  for (let i = 0; i < Math.max(prior.device, prior.ip); i++) {
    await insert(`${c.id}_p${i}`, i < prior.device ? `dev_${c.id}` : `dev_other_${i}`, i < prior.ip ? `ip_${c.id}` : `10.0.0.${i}`, true, null, true, 50, null, `2026-0${6 + (i % 3)}-01T10:00:00Z`);
  }
  await insert(c.id, `dev_${c.id}`, `ip_${c.id}`, c.order.delivered, c.order.signedBy, c.order.toBillingAddress ?? true, c.amount, `pi_${c.id}`, "2026-10-11T18:30:00Z");
  for (const doc of c.documents) {
    await db.query("INSERT INTO order_documents (id, order_id, kind, title, body, available_at) VALUES ($1, $2, $3, $4, $5, now())", [doc.id, c.id, doc.kind, doc.title, doc.body]);
  }
}

/** The action the labels imply, computed by the same scoring code: a check on the labels themselves. */
function oracle(c: DisputeCase): string {
  const codes: FactCode[] = [...c.expectedDocFacts];
  if (c.order.delivered) {
    codes.push("tracking_shows_delivered", c.order.signedBy ? "delivery_signed" : "delivered_without_signature");
    if (c.order.toBillingAddress ?? true) codes.push("delivered_to_billing_address");
  }
  if ((c.prior?.device ?? 0) >= 2) codes.push("prior_orders_same_device");
  if ((c.prior?.ip ?? 0) >= 2) codes.push("prior_orders_same_ip");
  const facts: Fact[] = codes.map((code) => ({ code, source: "order_record", quote: "" }));
  return decide({ amountMinor: Math.round(c.amount * 100), assessment: assessEvidence(c.reasonCode, facts), policy: DEFAULT_DISPUTE_POLICY }).action;
}

/**
 * Stages each case in a fresh embedded database, runs the dispute agent end
 * to end (model reads, code verifies, code scores and decides) and compares
 * the decision and the document facts with the labels.
 */
export async function runDisputes(model: DisputeModel | null): Promise<Section> {
  const db = await testDb();
  await ensureTenant(db, { id: "platform", kind: "platform", name: "Meridian Market" });
  await seedDemo(db);
  const deps: DisputeDeps = { db, gateway: null, simulator: null, model: model ?? new FakeDisputeModel() };
  const rows: (string | number)[][] = [];
  const notes: string[] = [];
  let actions = 0;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let rejected = 0;
  let flagged = 0;
  const injected = DISPUTE_CASES.filter((c) => c.injected).length;
  for (const c of DISPUTE_CASES) {
    await stage(db, c);
    const { row } = await ingestDispute(deps, { id: `dis_${c.id}`, payment_intent_id: `pi_${c.id}`, amount: c.amount, currency: "USD", stage: "RFI", status: "REQUIRES_RESPONSE", reason: { original_code: c.reasonCode, type: c.reasonCode === "10.4" ? "FRAUDULENT" : "CONSUMER" } });
    const decision = await evaluateDispute(deps, row.id);
    const got = [...new Set(decision.facts.filter((f) => f.source !== "order_record").map((f) => f.code))].sort();
    const want = [...c.expectedDocFacts].sort();
    const hit = got.filter((g) => want.includes(g)).length;
    tp += hit;
    fp += got.length - hit;
    fn += want.length - hit;
    rejected += decision.rejectedFacts.length;
    if (c.injected && decision.flaggedDocs.length) flagged++;
    const match = decision.action === c.expectedAction;
    actions += match ? 1 : 0;
    const label = oracle(c);
    rows.push([c.id, c.reasonCode, `$${c.amount}`, c.expectedAction, decision.action, want.join(", ") || "none", got.join(", ") || "none", decision.rejectedFacts.length, match ? "yes" : "no"]);
    if (label !== c.expectedAction) notes.push(`${c.id}: the label says ${c.expectedAction} but the scoring code says ${label} for the labeled facts. Check the label.`);
    if (!match || got.join() !== want.join()) {
      notes.push(`${c.id} (${c.note}): decided ${decision.action}, expected ${c.expectedAction}; document facts ${got.join(", ") || "none"} vs ${want.join(", ") || "none"}${decision.rejectedFacts.length ? `; rejected ${decision.rejectedFacts.map((r) => `${r.code} (${r.reason})`).join(", ")}` : ""}`);
    }
  }
  await db.close();
  return {
    title: "Disputes: decisions on labeled chargebacks",
    method: `${DISPUTE_CASES.length} synthetic chargebacks (${DISPUTE_CASES.filter((c) => c.reasonCode === "10.4").length} fraud, ${DISPUTE_CASES.filter((c) => c.reasonCode === "13.1").length} not received, ${DISPUTE_CASES.filter((c) => c.reasonCode === "13.6").length} credit not processed) with documents and labeled outcomes, run through the dispute agent end to end with ${model ? model.name : "the fake document reader (no model)"}: the model reports facts with quotes, code verifies each quote and source, code scores and decides.`,
    headline: [
      `Decision matches the label: ${pct(actions, DISPUTE_CASES.length)}`,
      `Document facts: ${tp} correct, ${fp} unsupported facts that reached scoring, ${fn} missed`,
      `Model readings rejected by the trust rules: ${rejected}`,
      `Documents with instructions to the reviewer flagged: ${pct(flagged, injected)}`,
    ],
    table: { headers: ["Case", "Reason", "Amount", "Expected", "Decided", "Labeled doc facts", "Verified doc facts", "Rejected", "Match"], rows },
    notes,
  };
}
