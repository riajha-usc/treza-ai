import type { Queryable } from "./db/client";

export const PLATFORM_TENANT_ID = "platform";

/**
 * Maps an Airwallex account id to a Treza tenant. Webhooks for a connected
 * account belong to that seller or customer; everything else is the platform.
 */
export async function tenantForAirwallexAccount(q: Queryable, accountId?: string | null): Promise<string> {
  if (!accountId) return PLATFORM_TENANT_ID;
  const rows = await q.query<{ id: string }>("SELECT id FROM tenants WHERE airwallex_account_id = $1", [accountId]);
  return rows[0]?.id ?? PLATFORM_TENANT_ID;
}
