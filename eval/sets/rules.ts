import type { PurchaseOption } from "../../src/lib/purchases/options";
import type { RiskTier } from "../../src/lib/purchases/policy";

const opt = (id: string, billing: PurchaseOption["billing"], amount: number, months = billing === "annual" ? 12 : billing === "monthly" ? 1 : 0): PurchaseOption => ({
  id,
  label: `${billing} ${amount}`,
  billing,
  chargeMinor: Math.round(amount * 100),
  currency: "USD",
  commitmentMonths: months,
  cancellable: billing !== "annual",
});

/** A purchase request against Lumen's seeded policy and cash, and what the rules must conclude. */
export interface RulesCase {
  id: string;
  vendor: string;
  mcc: string;
  purpose: string;
  options: PurchaseOption[];
  risk?: RiskTier;
  activeVendors?: string[];
  expected: { verdict: "approve" | "deny" | "review"; chosen: PurchaseOption["billing"] | null; needsHuman: boolean };
  note: string;
}

const PURPOSE = "Shipping label software to cut fulfilment time for marketplace orders";
const parcelwise = [opt("m", "monthly", 480), opt("a", "annual", 4723.2)];

export const RULES_CASES: RulesCase[] = [
  { id: "r01", vendor: "Parcelwise", mcc: "5734", purpose: PURPOSE, options: parcelwise, expected: { verdict: "review", chosen: "monthly", needsHuman: false }, note: "The demo: annual is cheaper but breaks the floor in week 7; $480 is above auto-approve" },
  { id: "r02", vendor: "Ledgerly", mcc: "5734", purpose: PURPOSE, options: [opt("m", "monthly", 29)], expected: { verdict: "approve", chosen: "monthly", needsHuman: false }, note: "Small, clean, within auto-approve" },
  { id: "r03", vendor: "Ledgerly", mcc: "5734", purpose: PURPOSE, options: [opt("m", "monthly", 250)], expected: { verdict: "approve", chosen: "monthly", needsHuman: false }, note: "Exactly at the auto-approve limit" },
  { id: "r04", vendor: "Ledgerly", mcc: "5734", purpose: PURPOSE, options: [opt("m", "monthly", 250.01)], expected: { verdict: "review", chosen: "monthly", needsHuman: false }, note: "One cent above auto-approve goes to review" },
  { id: "r05", vendor: "Steakhouse", mcc: "5812", purpose: PURPOSE, options: [opt("o", "one_time", 40)], expected: { verdict: "deny", chosen: null, needsHuman: false }, note: "Merchant category outside policy" },
  { id: "r06", vendor: "Parcelwise", mcc: "5734", purpose: PURPOSE, options: parcelwise, risk: "restricted", expected: { verdict: "deny", chosen: null, needsHuman: false }, note: "Restricted tenant: no new spend" },
  { id: "r07", vendor: "Parcelwise", mcc: "5734", purpose: PURPOSE, options: parcelwise, risk: "elevated", expected: { verdict: "review", chosen: "monthly", needsHuman: false }, note: "Elevated risk flags for review; $480 is under the $3,000 cap" },
  { id: "r08", vendor: "Guardrail", mcc: "7372", purpose: PURPOSE, options: [opt("a", "annual", 2400)], expected: { verdict: "review", chosen: "annual", needsHuman: true }, note: "At the human approval threshold" },
  { id: "r09", vendor: "Guardrail", mcc: "7372", purpose: PURPOSE, options: [opt("a", "annual", 1999.99)], expected: { verdict: "review", chosen: "annual", needsHuman: false }, note: "Just under the human approval threshold" },
  { id: "r10", vendor: "Bigdesk", mcc: "7372", purpose: PURPOSE, options: [opt("o", "one_time", 6500)], expected: { verdict: "deny", chosen: null, needsHuman: false }, note: "Above the policy maximum; also breaches the floor" },
  { id: "r11", vendor: "Ledgerly", mcc: "5734", purpose: PURPOSE, options: [opt("m", "monthly", 29)], activeVendors: ["ledgerly"], expected: { verdict: "review", chosen: "monthly", needsHuman: false }, note: "A card for this vendor already exists" },
  { id: "r12", vendor: "Ledgerly", mcc: "5734", purpose: "software", options: [opt("m", "monthly", 29)], expected: { verdict: "review", chosen: "monthly", needsHuman: false }, note: "Vague purpose" },
  { id: "r13", vendor: "Euroship", mcc: "5734", purpose: PURPOSE, options: [{ ...opt("m", "monthly", 89), currency: "EUR" }], expected: { verdict: "deny", chosen: null, needsHuman: false }, note: "Wrong currency" },
  { id: "r14", vendor: "Helpdeskly", mcc: "5734", purpose: PURPOSE, options: [opt("s", "monthly", 15), opt("g", "monthly", 45), opt("x", "monthly", 120)], expected: { verdict: "approve", chosen: "monthly", needsHuman: false }, note: "Cheapest tier wins among equals" },
  { id: "r15", vendor: "Barcodia", mcc: "5734", purpose: PURPOSE, options: [opt("o", "one_time", 1200), opt("m", "monthly", 100, 12)], expected: { verdict: "review", chosen: "one_time", needsHuman: false }, note: "One-time $1,200 costs the same over a year as 12 × $100 and keeps the floor; one_time sorts first" },
  { id: "r16", vendor: "Parcelwise", mcc: "5734", purpose: PURPOSE, options: parcelwise, risk: "high", expected: { verdict: "review", chosen: "monthly", needsHuman: true }, note: "High risk always needs a person" },
  { id: "r17", vendor: "Megawarehouse", mcc: "4215", purpose: PURPOSE, options: [opt("a", "annual", 5000)], expected: { verdict: "deny", chosen: null, needsHuman: false }, note: "Within the maximum but breaks the reserve floor" },
  { id: "r18", vendor: "Fleetline", mcc: "4215", purpose: PURPOSE, options: [opt("m", "monthly", 80), opt("o", "one_time", 350)], expected: { verdict: "review", chosen: "one_time", needsHuman: false }, note: "A one-time $350 beats $80 a month over a year; above auto-approve" },
  { id: "r19", vendor: "Zollkraft", mcc: "4816", purpose: PURPOSE, options: [opt("m", "monthly", 200)], expected: { verdict: "approve", chosen: "monthly", needsHuman: false }, note: "Allowed category, under auto-approve" },
  { id: "r20", vendor: "Nothing", mcc: "5734", purpose: PURPOSE, options: [], expected: { verdict: "deny", chosen: null, needsHuman: false }, note: "No options at all" },
];
