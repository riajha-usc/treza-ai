import { randomUUID } from "node:crypto";
import type { Queryable } from "../db/client";
import { toMajor } from "../money/money";
import type { PurchaseRow } from "../purchases/agent";

/**
 * A purchase instruction in the shape of Visa Intelligent Commerce's
 * documented mandate fields. Visa sums every transaction under an
 * instruction against declineThreshold.
 */
export interface Mandate {
  mandateId: string;
  purchaseType: "PURCHASE_RECURRING" | "PURCHASE_AUTONOMOUS";
  declineThreshold: { amount: number; currencyCode: string };
  /** Largest single charge, from the card's per-transaction limit. */
  perTransactionLimit: number;
  preferredMerchantName: string;
  merchantCategoryCode: string;
  effectiveUntilTime: string;
  recurringFrequency?: "MONTHLY";
}

export interface VicCredential {
  instructionId: string;
  network: "VISA";
  panLastFour: string | null;
  /** Issued by Visa Token Service. Not available without VIC onboarding. */
  paymentAccountReference: string | null;
}

/** What Treza needs from VIC. The real client needs Visa onboarding credentials. */
export interface VicClient {
  readonly provider: string;
  createInstruction(input: { purchaseId: string; mandate: Mandate; cardLastFour: string | null }): Promise<VicCredential>;
  confirm(instructionId: string, event: { amount: number; currency: string; merchantName: string; status: "APPROVED" | "DECLINED" }): Promise<void>;
}

/**
 * Stand-in for the VIC credentials-for-instruction call, clearly labeled.
 * It returns the documented response shape without calling Visa, because
 * VIC sandbox access requires Visa onboarding (TRID, API key, mTLS, MLE).
 */
export class StandInVicClient implements VicClient {
  readonly provider = "vic-stand-in";
  confirmations: { instructionId: string; status: string }[] = [];

  async createInstruction(input: { cardLastFour: string | null }): Promise<VicCredential> {
    return { instructionId: `vic_${randomUUID()}`, network: "VISA", panLastFour: input.cardLastFour, paymentAccountReference: null };
  }

  async confirm(instructionId: string, event: { status: string }) {
    this.confirmations.push({ instructionId, status: event.status });
  }
}

/** Turns an approved purchase and its card controls into a VIC-style mandate. */
export function mandateFor(row: PurchaseRow): Mandate {
  const chosen = row.decision.chosen!;
  const controls = row.decision.controls!;
  const limit = (interval: string) => controls.transaction_limits.limits.find((l) => l.interval === interval)?.amount;
  const charge = toMajor(chosen.chargeMinor, chosen.currency);
  const recurring = chosen.billing === "monthly";
  return {
    mandateId: `mdt_${row.id.slice(0, 8)}`,
    purchaseType: recurring ? "PURCHASE_RECURRING" : "PURCHASE_AUTONOMOUS",
    declineThreshold: { amount: limit("ALL_TIME") ?? charge, currencyCode: chosen.currency },
    perTransactionLimit: limit("PER_TRANSACTION") ?? charge,
    preferredMerchantName: row.vendor,
    merchantCategoryCode: row.merchant_category_code,
    effectiveUntilTime: controls.active_to,
    ...(recurring ? { recurringFrequency: "MONTHLY" as const } : {}),
  };
}

export interface InstructionRow {
  instruction_id: string;
  purchase_request_id: string;
  card_id: string | null;
  mandate: Mandate;
  credential: VicCredential;
  status: string;
  provider: string;
}

/** Creates the instruction for a purchase once, and returns it on later calls. */
export async function ensureInstruction(q: Queryable, vic: VicClient, row: PurchaseRow, card: { id: string; masked_number: string | null }): Promise<InstructionRow> {
  const [existing] = await q.query<InstructionRow>("SELECT * FROM vic_instructions WHERE purchase_request_id = $1 AND status = 'active'", [row.id]);
  if (existing) return existing;
  const mandate = mandateFor(row);
  const lastFour = card.masked_number?.replace(/\D/g, "").slice(-4) || null;
  const credential = await vic.createInstruction({ purchaseId: row.id, mandate, cardLastFour: lastFour });
  const [created] = await q.query<InstructionRow>(
    `INSERT INTO vic_instructions (instruction_id, purchase_request_id, card_id, mandate, credential, provider)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [credential.instructionId, row.id, card.id, JSON.stringify(mandate), JSON.stringify(credential), vic.provider],
  );
  return created;
}
