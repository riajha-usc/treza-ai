import { z } from "zod";
import type { Queryable } from "../db/client";

/**
 * A tenant's spend policy. Every number here is enforced by code and by the
 * card itself; the model never sets or changes a limit.
 */
export const PolicySchema = z.object({
  currency: z.string().length(3),
  /** Cash the tenant must keep at all times, in minor units. */
  reserveFloorMinor: z.number().int().nonnegative(),
  /** At or below this first charge, a clean request is approved without review. */
  autoApproveMaxMinor: z.number().int().nonnegative(),
  /** No single charge may exceed this, before risk adjustment. */
  maxChargeMinor: z.number().int().positive(),
  /** At or above this first charge, a person must approve. */
  humanApprovalFromMinor: z.number().int().positive(),
  /** Merchant category codes this tenant may buy from. */
  allowedMerchantCategories: z.array(z.string().regex(/^\d{4}$/)).min(1),
  blockedVendors: z.array(z.string()).default([]),
  /** Weeks of cash projection used to test each option against the reserve floor. */
  projectionWeeks: z.number().int().min(4).max(52).default(12),
  /** How long a card stays valid before the purchase must be reconsidered. */
  reconsiderAfterDays: z.number().int().min(7).max(365).default(90),
});
export type Policy = z.infer<typeof PolicySchema>;

/** Risk tiers come from the settlement and dispute agents (the closed loop). */
export type RiskTier = "low" | "elevated" | "high" | "restricted";

/** Spending caps shrink as a tenant's risk rises. */
export const RISK_CAP_MULTIPLIER: Record<RiskTier, number> = {
  low: 1,
  elevated: 0.5,
  high: 0.25,
  restricted: 0,
};

export async function loadPolicy(q: Queryable, tenantId: string): Promise<Policy | null> {
  const rows = await q.query<{ policy: unknown }>("SELECT policy FROM tenant_policies WHERE tenant_id = $1", [tenantId]);
  return rows[0] ? PolicySchema.parse(rows[0].policy) : null;
}

export async function savePolicy(q: Queryable, tenantId: string, policy: Policy): Promise<void> {
  const valid = PolicySchema.parse(policy);
  await q.query(
    `INSERT INTO tenant_policies (tenant_id, policy) VALUES ($1, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET policy = EXCLUDED.policy, updated_at = now()`,
    [tenantId, JSON.stringify(valid)],
  );
}

export async function loadRiskTier(q: Queryable, tenantId: string): Promise<{ tier: RiskTier; reasons: string[] }> {
  const rows = await q.query<{ tier: RiskTier; reasons: string[] }>(
    "SELECT tier, reasons FROM tenant_risk WHERE tenant_id = $1",
    [tenantId],
  );
  return rows[0] ?? { tier: "low", reasons: [] };
}
