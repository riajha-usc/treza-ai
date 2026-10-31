import { beforeEach, describe, expect, it } from "vitest";
import { buildBus } from "@/lib/app";
import { listAudit } from "@/lib/audit/audit";
import { signForTests } from "@/lib/airwallex/webhook";
import { testDb, type Db } from "@/lib/db/client";
import { PLATFORM_ACCOUNTS } from "@/lib/ledger/accounts";
import { accountBalance, ensureTenant } from "@/lib/ledger/ledger";
import { intakeAirwallexWebhook } from "@/lib/intake";

const secret = "whsec_test";
const now = 1_761_500_000_000;

function delivery(body: object) {
  const rawBody = JSON.stringify(body);
  const timestamp = String(now);
  return { rawBody, timestamp, signature: signForTests(secret, timestamp, rawBody) };
}

const deposit = {
  id: "evt_dep_1",
  name: "deposit.settled",
  created_at: "2026-10-26T12:00:00Z",
  data: { object: { id: "dep_1", amount: 25000, currency: "USD", status: "SETTLED" } },
};

let db: Db;
beforeEach(async () => {
  db = await testDb();
  await ensureTenant(db, { id: "platform", kind: "platform", name: "Platform" });
});

describe("Phase 1 done-when: a webhook lands in the ledger and the audit log", () => {
  it("books a settled platform deposit exactly once, even if Airwallex redelivers it", async () => {
    const bus = buildBus();
    const first = await intakeAirwallexWebhook(db, delivery(deposit), secret, now);
    const again = await intakeAirwallexWebhook(db, delivery(deposit), secret, now);
    expect(first).toMatchObject({ status: 200, duplicate: false });
    expect(again).toMatchObject({ status: 200, duplicate: true });

    await bus.processPending(db);
    await bus.processPending(db);

    expect(await accountBalance(db, "platform", PLATFORM_ACCOUNTS.cash, "USD")).toBe(2_500_000);
    const audit = await listAudit(db, { subjectId: "dep_1" });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor: "system", action: "ledger.deposit_booked" });
  });

  it("rejects unsigned or forged deliveries", async () => {
    const d = delivery(deposit);
    expect(await intakeAirwallexWebhook(db, { ...d, signature: "00" }, secret, now)).toMatchObject({ status: 401 });
    expect(await intakeAirwallexWebhook(db, d, undefined, now)).toMatchObject({ status: 503 });
  });

  it("rejects payloads that are not Airwallex envelopes", async () => {
    expect(await intakeAirwallexWebhook(db, delivery({ hello: "world" }), secret, now)).toMatchObject({ status: 400 });
  });
});
