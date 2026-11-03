import type { Db } from "../db/client";
import { toMinor } from "../money/money";

const usd = (n: number) => toMinor(n, "USD");

/** Refund history and tenure. Kestrel is the newest seller with the most refunds. */
export const SELLER_METRICS = [
  { tenantId: "seller_lumen", refundRateBps: 250, firstSaleAt: "2025-03-01T00:00:00Z" },
  { tenantId: "seller_harbor", refundRateBps: 100, firstSaleAt: "2024-08-15T00:00:00Z" },
  { tenantId: "seller_kestrel", refundRateBps: 800, firstSaleAt: "2026-09-25T00:00:00Z" },
];

/** What buyers paid each seller this cycle, and what was refunded. */
export const DEMO_CYCLE_SALES = [
  { tenantId: "seller_lumen", grossMinor: usd(6_400), refundsMinor: usd(160) },
  { tenantId: "seller_harbor", grossMinor: usd(9_800), refundsMinor: usd(98) },
  { tenantId: "seller_kestrel", grossMinor: usd(3_200), refundsMinor: usd(256) },
];

/** The builder guide's Kit 08 twist: a carrier failure at one seller after payout. */
export const DEMO_CARRIER_FAILURE = {
  tenantId: "seller_lumen",
  carrier: "ParcelPort",
  undeliveredOrders: 34,
  undeliveredValueMinor: usd(2_108),
  refundsRequestedMinor: usd(560),
};

/** Late deposits and the bridge requests they cause (Kit 05). */
export const DEMO_BRIDGE_REQUESTS = [
  { tenantId: "seller_lumen", amountMinor: usd(1_380), purpose: "Supplier invoice due today; marketplace deposit lands in 3 days" },
  { tenantId: "seller_harbor", amountMinor: usd(1_800), purpose: "Kiln repair due today; wholesale deposit lands in 5 days" },
  { tenantId: "seller_kestrel", amountMinor: usd(1_200), purpose: "Inventory restock; deposit date unknown" },
];

export async function seedSellerMetrics(db: Db): Promise<void> {
  for (const m of SELLER_METRICS) {
    await db.query(
      `INSERT INTO seller_metrics (tenant_id, trailing_refund_rate_bps, first_sale_at)
       SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM tenants WHERE id = $1) ON CONFLICT (tenant_id) DO NOTHING`,
      [m.tenantId, m.refundRateBps, m.firstSaleAt],
    );
  }
}
