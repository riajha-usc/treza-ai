import type { PlatformGateway, PlatformSimulator } from "../airwallex/platform";
import type { Db, Queryable } from "../db/client";
import { SELLER_ACCOUNTS } from "../ledger/accounts";
import { tenantBalances } from "../ledger/ledger";

export interface SettlementDeps {
  db: Db;
  gateway: PlatformGateway | null;
  simulator: PlatformSimulator | null;
  sleep?: (ms: number) => Promise<void>;
}

export const wait = (deps: SettlementDeps, ms: number) => (deps.sleep ?? ((t: number) => new Promise((r) => setTimeout(r, t))))(ms);

export interface SellerRow {
  id: string;
  name: string;
  airwallex_account_id: string | null;
  trailing_refund_rate_bps: number;
  first_sale_at: string;
  airwallex_global_account_id: string | null;
}

export async function sellers(q: Queryable): Promise<SellerRow[]> {
  return q.query<SellerRow>(
    `SELECT t.id, t.name, t.airwallex_account_id, m.trailing_refund_rate_bps, m.first_sale_at, m.airwallex_global_account_id
     FROM tenants t JOIN seller_metrics m ON m.tenant_id = t.id WHERE t.kind = 'seller' ORDER BY t.name`,
  );
}

/** What the platform holds for one seller, read from that seller's own ledger accounts. */
export async function sellerPosition(q: Queryable, tenantId: string, currency = "USD") {
  const all = await tenantBalances(q, tenantId);
  const get = (code: string) => all.find((b) => b.code === code && b.currency === currency)?.balanceMinor ?? 0;
  return {
    payableMinor: get(SELLER_ACCOUNTS.payable.code),
    reserveMinor: get(SELLER_ACCOUNTS.reserve.code),
    receivableMinor: get(SELLER_ACCOUNTS.receivable.code),
  };
}

/** Chargebacks still open against a seller, held in full in the reserve. */
export async function openDisputesMinor(q: Queryable, tenantId: string): Promise<number> {
  const [{ total }] = await q.query<{ total: number }>(
    `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS total FROM disputes
     WHERE seller_tenant_id = $1 AND status NOT IN ('WON', 'LOST', 'ACCEPTED', 'REVERSED', 'EXPIRED')`,
    [tenantId],
  );
  return total;
}

export async function exposureMinor(q: Queryable, tenantId: string): Promise<number> {
  const [{ total }] = await q.query<{ total: number }>(
    "SELECT COALESCE(SUM(exposure_minor), 0)::bigint AS total FROM exposure_events WHERE tenant_id = $1",
    [tenantId],
  );
  return total;
}
