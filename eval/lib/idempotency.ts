import { onceForOperation } from "../../src/lib/airwallex/idempotency";
import { testDb } from "../../src/lib/db/client";
import { emit } from "../../src/lib/events/bus";
import { PLATFORM_ACCOUNTS, SELLER_ACCOUNTS } from "../../src/lib/ledger/accounts";
import { ensureTenant, postEntry } from "../../src/lib/ledger/ledger";
import { seedDemo } from "../../src/lib/seed";
import type { Section } from "./report";

const N = 200;

/** The same event, ledger entry and outbound call replayed many times, in sequence and at once. */
export async function runIdempotency(): Promise<Section> {
  const db = await testDb();
  await ensureTenant(db, { id: "platform", kind: "platform", name: "Meridian Market" });
  await seedDemo(db);
  let duplicates = 0;
  for (let i = 0; i < N; i++) if ((await emit(db, { key: "eval:deposit", type: "deposit.settled", payload: { i } })).duplicate) duplicates++;
  const [{ events }] = await db.query<{ events: number }>("SELECT count(*)::int AS events FROM events WHERE external_id = 'eval:deposit'");

  const entry = () =>
    postEntry(db, {
      idempotencyKey: "eval:entry",
      kind: "payout",
      description: "Replayed payout",
      lines: [
        { tenantId: "platform", account: PLATFORM_ACCOUNTS.cash, amountMinor: -1_000, currency: "USD" },
        { tenantId: "seller_lumen", account: SELLER_ACCOUNTS.payable, amountMinor: 1_000, currency: "USD" },
      ],
    });
  for (let i = 0; i < N; i++) await entry();
  await Promise.all(Array.from({ length: 50 }, entry));
  const [{ entries }] = await db.query<{ entries: number }>("SELECT count(*)::int AS entries FROM journal_entries WHERE idempotency_key = 'eval:entry'");

  let calls = 0;
  const ids = new Set<string>();
  for (let i = 0; i < N; i++) {
    const r = await onceForOperation(db, { key: "eval:transfer", method: "POST", path: "/api/v1/transfers/create" }, async (requestId) => {
      calls++;
      return { id: `tr_${requestId}` };
    });
    ids.add(r.requestId);
  }
  await db.close();
  return {
    title: "Replays: events, ledger entries and outbound calls",
    method: `The same webhook event, the same ledger entry (${N} times in sequence, then 50 at once) and the same money-moving call replayed ${N} times against the embedded database.`,
    headline: [
      `Event rows created from ${N} identical deliveries: ${events} (${duplicates} recognised as duplicates)`,
      `Journal entries created from ${N + 50} identical postings: ${entries}`,
      `Airwallex calls made for ${N} replays of one operation: ${calls}, with ${ids.size} distinct request id`,
    ],
    table: { headers: ["Replay", "Attempts", "Effects"], rows: [["Webhook event", N, events], ["Ledger entry", N + 50, entries], ["Outbound call", N, calls]] },
    notes: [],
  };
}
