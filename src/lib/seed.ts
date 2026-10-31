import type { Db } from "./db/client";
import { ensureTenant } from "./ledger/ledger";
import { toMinor } from "./money/money";
import { savePolicy, type Policy } from "./purchases/policy";
import { PLATFORM_TENANT_ID } from "./tenancy";

const usd = (n: number) => toMinor(n, "USD");

export const SELLERS = [
  { id: "seller_lumen", name: "Lumen Home Goods", risk: "low", startingCash: 9_000 },
  { id: "seller_harbor", name: "Harbor & Pine Ceramics", risk: "low", startingCash: 12_000 },
  { id: "seller_kestrel", name: "Kestrel Outdoor", risk: "elevated", startingCash: 4_500 },
] as const;

const SELLER_POLICY: Policy = {
  currency: "USD",
  reserveFloorMinor: usd(3_000),
  autoApproveMaxMinor: usd(250),
  maxChargeMinor: usd(6_000),
  humanApprovalFromMinor: usd(2_000),
  allowedMerchantCategories: ["5734", "5817", "7372", "4816", "5045", "5943", "4215", "7311"],
  blockedVendors: [],
  projectionWeeks: 12,
  reconsiderAfterDays: 90,
};

/**
 * Weekly cash for Lumen Home Goods. Chosen so that, as in the builder
 * guide's Kit 02 scenario, annual billing is cheaper but pushes cash below
 * the reserve floor in week 7, while monthly billing never does.
 */
const LUMEN_FLOWS: [number, number, string][] = [
  ...Array.from({ length: 12 }, (_, i) => [i + 1, 900, "Marketplace payout"] as [number, number, string]),
  [2, -600, "Inventory restock"],
  [4, -1_500, "Payroll"],
  [6, -900, "Packaging supplies"],
  [7, -5_800, "Payroll and quarterly sales tax"],
  [10, -1_500, "Payroll"],
  [12, -1_200, "Inventory restock"],
];

export const PARCELWISE_TERMS = `Parcelwise Shipping Suite for growing online sellers.
Monthly plan: $480 per month, cancel anytime.
Annual plan: $4,723.20 per year, billed upfront with a 12-month commitment (save 18%).
All prices in USD, excluding applicable taxes.`;

/** Seeds a small demo marketplace once. Safe to call on every boot. */
export async function seedDemo(db: Db): Promise<boolean> {
  const [{ n }] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM tenants WHERE kind = 'seller'");
  if (n > 0) return false;

  await savePolicy(db, PLATFORM_TENANT_ID, { ...SELLER_POLICY, reserveFloorMinor: usd(20_000), maxChargeMinor: usd(15_000) });
  await db.query("INSERT INTO cash_positions (tenant_id, currency, balance_minor) VALUES ($1, 'USD', $2) ON CONFLICT DO NOTHING", [
    PLATFORM_TENANT_ID,
    usd(60_000),
  ]);

  for (const s of SELLERS) {
    await ensureTenant(db, { id: s.id, kind: "seller", name: s.name });
    await savePolicy(db, s.id, SELLER_POLICY);
    await db.query("INSERT INTO cash_positions (tenant_id, currency, balance_minor) VALUES ($1, 'USD', $2)", [s.id, usd(s.startingCash)]);
    await db.query(
      `INSERT INTO tenant_risk (tenant_id, tier, score, reasons) VALUES ($1, $2, $3, $4)`,
      [s.id, s.risk, s.risk === "low" ? 10 : 45, JSON.stringify(s.risk === "low" ? [] : ["New seller with under 60 days of history"])],
    );
  }
  for (const [week, amount, description] of LUMEN_FLOWS) {
    await db.query("INSERT INTO cash_flows (tenant_id, week, amount_minor, currency, description) VALUES ('seller_lumen', $1, $2, 'USD', $3)", [
      week,
      usd(amount),
      description,
    ]);
  }
  return true;
}
