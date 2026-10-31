import { recordDecision } from "../audit/audit";
import type { Db } from "../db/client";
import type { EventRow } from "../events/bus";
import { PLATFORM_ACCOUNTS } from "../ledger/accounts";
import { postEntry } from "../ledger/ledger";
import { toMinor } from "../money/money";
import { PLATFORM_TENANT_ID } from "../tenancy";

interface DepositObject {
  id?: string;
  amount?: number | string;
  currency?: string;
  status?: string;
  global_account_id?: string;
}

/**
 * deposit.settled on the platform wallet: cash arrived, so book it.
 * Seller wallet deposits belong to the seller and are handled by the
 * settlement agent, not booked as platform cash here.
 */
export async function onDepositSettled(event: EventRow, db: Db): Promise<void> {
  if (event.tenant_id !== PLATFORM_TENANT_ID) return;
  const obj = (event.payload as { data?: { object?: DepositObject } }).data?.object ?? {};
  const amount = Number(obj.amount);
  if (!obj.currency || !Number.isFinite(amount) || amount <= 0) {
    throw new Error(`deposit event ${event.external_id} has no usable amount or currency`);
  }
  const currency = obj.currency.toUpperCase();
  const minor = toMinor(amount, currency);
  const depositId = obj.id ?? event.external_id;

  const { entryId, created } = await postEntry(db, {
    idempotencyKey: `deposit:${depositId}`,
    kind: "deposit",
    description: `Deposit ${depositId} settled into platform wallet`,
    metadata: { depositId, globalAccountId: obj.global_account_id ?? null, eventId: event.id },
    lines: [
      { tenantId: PLATFORM_TENANT_ID, account: PLATFORM_ACCOUNTS.cash, amountMinor: minor, currency },
      { tenantId: PLATFORM_TENANT_ID, account: PLATFORM_ACCOUNTS.funding, amountMinor: -minor, currency },
    ],
  });
  if (created) {
    await recordDecision(db, {
      tenantId: PLATFORM_TENANT_ID,
      actor: "system",
      action: "ledger.deposit_booked",
      subjectType: "deposit",
      subjectId: depositId,
      inputs: { eventId: event.id, amount, currency },
      outcome: { entryId, amountMinor: minor },
    });
  }
}
