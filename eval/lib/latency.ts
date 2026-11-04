import { FakeIssuer, FakeModel } from "../../tests/fakes";
import { testDb } from "../../src/lib/db/client";
import { ensureTenant } from "../../src/lib/ledger/ledger";
import { submitPurchase, type PurchaseDeps } from "../../src/lib/purchases/agent";
import { PARCELWISE_TERMS, seedDemo } from "../../src/lib/seed";
import { agentCheckout } from "../../src/lib/visa/agent-checkout";
import { decideAuthorization } from "../../src/lib/visa/remote-auth";
import { StandInVicClient } from "../../src/lib/visa/vic";
import { quantile, type Section } from "./report";

const N = 500;

/** Remote authorization decisions timed locally, after a signed checkout established the mandate. */
export async function runLatency(): Promise<Section> {
  const db = await testDb();
  await ensureTenant(db, { id: "platform", kind: "platform", name: "Meridian Market" });
  await seedDemo(db);
  const issuer = new FakeIssuer();
  const purchases: PurchaseDeps = { db, model: new FakeModel("approve"), issuer, simulator: issuer, sleep: async () => {} };
  const row = await submitPurchase(purchases, { tenantId: "seller_lumen", requester: "Maya Chen", vendor: "Parcelwise", merchantCategoryCode: "5734", purpose: "Shipping label software to cut fulfilment time for marketplace orders", termsText: PARCELWISE_TERMS, currency: "USD" });
  await agentCheckout({ purchases, vic: new StandInVicClient(), remoteAuthLive: false }, row.id, "honest");
  const [card] = await db.query<{ airwallex_card_id: string }>("SELECT airwallex_card_id FROM cards");
  const times: number[] = [];
  const outcomes = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    const renewal = i % 2 === 0;
    const p = { card_id: card.airwallex_card_id, card_transaction_event_id: `eval_${i}`, transaction_amount: renewal ? 480 : 40, transaction_currency: "USD", merchant: { category_code: renewal ? "5734" : "5812", name: "Parcelwise" } };
    const t = performance.now();
    const a = await decideAuthorization(db, p);
    times.push(performance.now() - t);
    const k = `${a.response_status}: ${a.status_reason}`;
    outcomes.set(k, (outcomes.get(k) ?? 0) + 1);
  }
  await db.close();
  const s = [...times].sort((a, b) => a - b);
  const ms = (v: number) => `${v.toFixed(1)} ms`;
  return {
    title: "Remote authorization: decision time",
    method: `${N} authorization requests decided locally against the embedded database after one signed checkout: half renewals at the mandate price, half out-of-category charges. Airwallex allows 2,500 ms for an answer; Treza's own guard answers DECLINED at 2,000 ms. Live sandbox decisions recorded earlier took 3 to 6 ms.`,
    headline: [`Median ${ms(quantile(s, 0.5))}, p95 ${ms(quantile(s, 0.95))}, p99 ${ms(quantile(s, 0.99))}, max ${ms(s.at(-1)!)}`, `Decisions over 2,000 ms: ${s.filter((v) => v > 2000).length}`],
    table: { headers: ["Outcome", "Count"], rows: [...outcomes.entries()].map(([k, n]) => [k, n]) },
    notes: [],
  };
}
