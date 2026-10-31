import { recordDecision } from "../audit/audit";
import type { Queryable } from "../db/client";
import { emit } from "../events/bus";
import type { RiskTier } from "../purchases/policy";

/** Score bands. Purchases, reserves and approvals all read the resulting tier. */
export function tierFor(score: number): RiskTier {
  if (score >= 85) return "restricted";
  if (score >= 60) return "high";
  if (score >= 30) return "elevated";
  return "low";
}

/**
 * Raises a tenant's risk from a new signal, such as a chargeback. This is
 * the shared edge of the closed loop: the purchase agent tightens cards and
 * the settlement agent raises reserves from the same tier.
 */
export async function recordRiskSignal(
  q: Queryable,
  tenantId: string,
  signal: { key: string; weight: number; reason: string },
): Promise<{ tier: RiskTier; score: number; changed: boolean }> {
  const { duplicate } = await emit(q, {
    key: `risk:${signal.key}`,
    type: "risk.signal",
    tenantId,
    payload: { weight: signal.weight, reason: signal.reason },
  });
  const [before] = await q.query<{ tier: RiskTier; score: number; reasons: string[] }>(
    "SELECT tier, score, reasons FROM tenant_risk WHERE tenant_id = $1",
    [tenantId],
  );
  const current = before ?? { tier: "low" as RiskTier, score: 0, reasons: [] };
  // The same signal never counts twice.
  if (duplicate) return { tier: current.tier, score: current.score, changed: false };

  const score = Math.min(100, current.score + signal.weight);
  const tier = tierFor(score);
  const reasons = [...current.reasons, signal.reason].slice(-5);
  await q.query(
    `INSERT INTO tenant_risk (tenant_id, tier, score, reasons, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (tenant_id) DO UPDATE SET tier = $2, score = $3, reasons = $4, updated_at = now()`,
    [tenantId, tier, score, JSON.stringify(reasons)],
  );
  await recordDecision(q, {
    tenantId,
    actor: "rules",
    action: tier === current.tier ? "risk.score_raised" : "risk.tier_changed",
    subjectType: "tenant",
    subjectId: tenantId,
    inputs: { signal: signal.reason, weight: signal.weight },
    outcome: { from: current.tier, to: tier, score },
  });
  return { tier, score, changed: tier !== current.tier };
}
