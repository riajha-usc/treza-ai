import { createHmac, timingSafeEqual } from "node:crypto";
import { recordDecision } from "../audit/audit";
import type { Queryable } from "../db/client";
import { loadRiskTier } from "../purchases/policy";
import type { Check } from "./tap";
import type { InstructionRow } from "./vic";

/** Airwallex remote authorization request, version 2 (fields Treza uses). */
export interface RemoteAuthRequest {
  card_id: string;
  card_transaction_event_id: string;
  transaction_type?: string;
  transaction_amount: number;
  transaction_currency: string;
  merchant?: { name?: string; category_code?: string };
}

export interface RemoteAuthAnswer {
  card_transaction_event_id: string;
  response_status: "AUTHORIZED" | "DECLINED";
  status_reason: string;
}

/**
 * Airwallex signs remote authorization calls with x-nonce ("<epochMillis>.<random>")
 * and x-signature = Base64(HMAC-SHA256(shared_secret, x-nonce)).
 */
export function verifyRemoteAuthSignature(input: { nonce: string | null; signature: string | null; secret: string; now?: number; toleranceMs?: number }): boolean {
  if (!input.nonce || !input.signature) return false;
  const ts = Number(input.nonce.split(".")[0]);
  if (!Number.isFinite(ts) || Math.abs((input.now ?? Date.now()) - ts) > (input.toleranceMs ?? 5 * 60_000)) return false;
  const expected = Buffer.from(createHmac("sha256", input.secret).update(input.nonce).digest("base64"));
  const got = Buffer.from(input.signature.trim());
  return expected.length === got.length && timingSafeEqual(expected, got);
}

const INTENT_WINDOW_MS = 15 * 60_000;

/**
 * Decides one card authorization from Treza's own records, in milliseconds,
 * with no model in the path. The charge must match an active mandate, and
 * the first charge must match a checkout a merchant verified as signed by
 * Treza's agent.
 */
export async function decideAuthorization(q: Queryable, p: RemoteAuthRequest, now = Date.now()): Promise<RemoteAuthAnswer & { checks: Check[] }> {
  const checks: Check[] = [];
  const answer = (pass: boolean, reason: string) => ({
    card_transaction_event_id: p.card_transaction_event_id,
    response_status: pass ? ("AUTHORIZED" as const) : ("DECLINED" as const),
    status_reason: reason,
    checks,
  });
  const check = (name: string, pass: boolean, detail: string) => (checks.push({ name, pass, detail }), pass);

  const [card] = await q.query<{ id: string; tenant_id: string; status: string }>("SELECT id, tenant_id, status FROM cards WHERE airwallex_card_id = $1", [p.card_id]);
  if (!check("card known", Boolean(card), card ? "Card issued by Treza" : "Not a Treza card")) return answer(false, "Unknown card");
  if (!check("card active", card.status === "ACTIVE", `Card status ${card.status}`)) return answer(false, "Card is not active");

  const risk = await loadRiskTier(q, card.tenant_id);
  if (!check("seller risk", risk.tier !== "restricted", `Risk tier ${risk.tier}`)) return answer(false, "Tenant is restricted");

  const [ins] = await q.query<InstructionRow>("SELECT * FROM vic_instructions WHERE card_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1", [card.id]);
  if (!check("mandate", Boolean(ins), ins ? `Instruction ${ins.instruction_id}` : "No active purchase instruction")) return answer(false, "No mandate for this card");
  const m = ins.mandate;
  if (!check("mandate current", Date.parse(m.effectiveUntilTime) > now, `Effective until ${m.effectiveUntilTime.slice(0, 10)}`)) return answer(false, "Mandate expired");
  const mcc = p.merchant?.category_code;
  if (!check("merchant category", !mcc || mcc === m.merchantCategoryCode, `Charge ${mcc ?? "unknown"}, mandate ${m.merchantCategoryCode}`)) return answer(false, "Merchant category outside the mandate");
  if (!check("per-charge limit", p.transaction_amount <= m.perTransactionLimit, `${p.transaction_amount} of at most ${m.perTransactionLimit}`)) return answer(false, "Above the mandate's per-charge limit");

  const [{ spent }] = await q.query<{ spent: number }>(
    `SELECT COALESCE(SUM((payload->>'transaction_amount')::numeric), 0)::float AS spent FROM remote_auth_decisions
     WHERE card_id = $1 AND response_status = 'AUTHORIZED'`,
    [card.id],
  );
  const total = spent + p.transaction_amount;
  if (!check("mandate total", total <= m.declineThreshold.amount, `${total} of ${m.declineThreshold.amount} total`)) return answer(false, "Mandate total would be exceeded");

  // A recurring mandate covers later charges; the first charge needs a signed intent.
  const first = spent === 0;
  if (first || m.purchaseType !== "PURCHASE_RECURRING") {
    const [intent] = await q.query<{ id: string }>(
      `SELECT id FROM agent_checkouts WHERE card_id = $1 AND verified AND amount_minor = $2 AND created_at > $3 ORDER BY created_at DESC LIMIT 1`,
      [card.id, Math.round(p.transaction_amount * 100), new Date(now - INTENT_WINDOW_MS).toISOString()],
    );
    if (!check("signed agent intent", Boolean(intent), intent ? "Merchant verified a TAP-signed checkout for this amount" : "No verified agent checkout for this amount in the last 15 minutes")) {
      return answer(false, "No verified agent intent for this charge");
    }
  } else check("signed agent intent", true, "Recurring charge under an already verified mandate");
  return answer(true, "Matches an active, agent-verified mandate");
}

/** Records the answer so the dispute agent and the audit trail can rely on it. */
export async function recordAuthorization(q: Queryable, p: RemoteAuthRequest, a: RemoteAuthAnswer & { checks: Check[] }, latencyMs: number, tenantId?: string | null) {
  const [card] = await q.query<{ id: string; tenant_id: string }>("SELECT id, tenant_id FROM cards WHERE airwallex_card_id = $1", [p.card_id]);
  await q.query(
    `INSERT INTO remote_auth_decisions (card_transaction_event_id, card_id, response_status, status_reason, checks, latency_ms, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
    [p.card_transaction_event_id, card?.id ?? null, a.response_status, a.status_reason, JSON.stringify(a.checks), latencyMs, JSON.stringify(p)],
  );
  await recordDecision(q, {
    tenantId: tenantId ?? card?.tenant_id ?? null,
    actor: "rules",
    action: `remote_auth.${a.response_status.toLowerCase()}`,
    subjectType: "card",
    subjectId: card?.id ?? p.card_id,
    inputs: { amount: p.transaction_amount, mcc: p.merchant?.category_code ?? null },
    outcome: { status: a.response_status, reason: a.status_reason },
    latencyMs,
  });
}
