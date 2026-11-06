import { onceForOperation } from "../airwallex/idempotency";
import type { SellerIdentity, SellerProfile } from "../airwallex/platform";
import { recordDecision } from "../audit/audit";
import { wait, type SettlementDeps } from "./deps";

/**
 * Identity values for onboarding (an EIN and an ID for each business owner)
 * come from the SELLER_IDENTITIES environment variable, which the operator
 * fills in locally. They are never written in code or committed.
 */
export const IDENTITIES_ENV = "SELLER_IDENTITIES";

export function loadSellerIdentities(): Record<string, SellerIdentity> | null {
  const raw = process.env[IDENTITIES_ENV]?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, SellerIdentity>;
  } catch {
    return null;
  }
}

/** Demo sellers. Identity is attached at onboarding time from the local file. */
export const SELLER_PROFILES: Omit<SellerProfile, "identity">[] = [
  { tenantId: "seller_lumen", businessName: "Lumen Home Goods LLC", industryCategoryCode: "ICCV3_1014XX", description: "Candles, glassware and home decor sold through the Meridian Market online marketplace", monthlyRevenue: 25000, email: "owner+lumen@example.com", person: { firstName: "Maya", lastName: "Chen" }, address: { line1: "500 Congress Ave", suburb: "Austin", state: "TX", postcode: "78701" } },
  { tenantId: "seller_harbor", businessName: "Harbor and Pine Ceramics LLC", industryCategoryCode: "ICCV3_1014XX", description: "Handmade stoneware dinnerware and ceramics sold through the Meridian Market online marketplace", monthlyRevenue: 40000, email: "owner+harbor@example.com", person: { firstName: "Theo", lastName: "Marsh" }, address: { line1: "12 Lexington Ave", suburb: "Asheville", state: "NC", postcode: "28801" } },
  { tenantId: "seller_kestrel", businessName: "Kestrel Outdoor LLC", industryCategoryCode: "ICCV3_1023XX", description: "Camping and hiking gear sold through the Meridian Market online marketplace", monthlyRevenue: 12000, email: "owner+kestrel@example.com", person: { firstName: "Ava", lastName: "Reyes" }, address: { line1: "77 Pine Ridge Road", suburb: "Boise", state: "ID", postcode: "83702" } },
];

/**
 * Creates, submits and activates a connected account per seller, then gives
 * each one a Global Account so deposits can land in the seller's own wallet.
 * Safe to run again: every step is keyed to the seller.
 */
export async function onboardSellers(deps: SettlementDeps, identities: Record<string, SellerIdentity> | null = loadSellerIdentities()): Promise<string[]> {
  const { db, gateway, simulator } = deps;
  if (!gateway || !simulator) return ["Airwallex platform access is not configured"];
  const log: string[] = [];
  for (const base of SELLER_PROFILES) {
    const identity = identities?.[base.tenantId];
    if (!identity?.ein || !identity.person?.number) {
      log.push(`${base.businessName}: skipped. Add its sandbox identity to ${IDENTITIES_ENV} to onboard it.`);
      continue;
    }
    const p: SellerProfile = { ...base, identity };
    const [t] = await db.query<{ airwallex_account_id: string | null }>("SELECT airwallex_account_id FROM tenants WHERE id = $1", [p.tenantId]);
    let accountId = t?.airwallex_account_id ?? null;
    if (!accountId) {
      // Airwallex allows one account per identifier. A run after a database reset finds the earlier one instead of failing.
      const found = await gateway.findAccount(p.tenantId);
      if (found) {
        accountId = found.id;
        log.push(`${p.businessName}: found connected account ${accountId} from an earlier run (${found.status})`);
      } else {
        const { result } = await onceForOperation(db, { key: `account:${p.tenantId}`, tenantId: p.tenantId, method: "POST", path: "/api/v1/accounts/create" }, () => gateway.createAccount(p));
        accountId = result.id;
      }
      // A retry may find an account created on an earlier attempt; make sure its details are complete before submitting.
      let status = (await gateway.getAccount(accountId)).status;
      if (status === "CREATED") {
        await gateway.updateAccount(accountId, p);
        status = (await gateway.submitAccount(accountId)).status;
      }
      // An account from an earlier run may already be active; the sandbox refuses to activate it twice.
      if (status !== "ACTIVE") {
        await wait(deps, 2_000); // The guide: wait about two seconds after submit.
        await simulator.activateAccount(accountId);
        status = (await gateway.getAccount(accountId)).status;
        for (let i = 0; i < 10 && status !== "ACTIVE"; i++) {
          await wait(deps, 1_000);
          status = (await gateway.getAccount(accountId)).status;
        }
      }
      await db.query("UPDATE tenants SET airwallex_account_id = $2 WHERE id = $1", [p.tenantId, accountId]);
      await recordDecision(db, { tenantId: p.tenantId, actor: "system", action: "seller.onboarded", subjectType: "tenant", subjectId: p.tenantId, outcome: { accountId, status } });
      log.push(`${p.businessName}: connected account ${accountId} ${status}`);
    } else log.push(`${p.businessName}: already onboarded as ${accountId}`);

    const [m] = await db.query<{ airwallex_global_account_id: string | null }>("SELECT airwallex_global_account_id FROM seller_metrics WHERE tenant_id = $1", [p.tenantId]);
    if (!m?.airwallex_global_account_id) {
      const { result: ga } = await onceForOperation(
        db,
        { key: `global-account:${p.tenantId}`, tenantId: p.tenantId, method: "POST", path: "/api/v1/global_accounts/create" },
        (requestId) => gateway.createGlobalAccount({ requestId, onBehalfOf: accountId! }),
      );
      await db.query("UPDATE seller_metrics SET airwallex_global_account_id = $2 WHERE tenant_id = $1", [p.tenantId, ga.id]);
      log.push(`${p.businessName}: Global Account ${ga.id}`);
    }
  }
  return log;
}
