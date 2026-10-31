import { projectCash, type CashFlow, type Projection } from "./cash";
import { costOverMonths, type PurchaseOption } from "./options";
import { RISK_CAP_MULTIPLIER, type Policy, type RiskTier } from "./policy";

export type Verdict = "approve" | "deny" | "review";

export interface RuleResult {
  code: string;
  /** info records context, such as a cheaper option deferred for cash reasons. */
  outcome: "pass" | "fail" | "flag" | "info";
  detail: string;
}

export interface RulesInput {
  vendor: string;
  merchantCategoryCode: string;
  purpose: string;
  options: PurchaseOption[];
  policy: Policy;
  risk: { tier: RiskTier; reasons: string[] };
  cash: { startingBalanceMinor: number; flows: CashFlow[] };
  /** Vendors this tenant already holds an active card for. */
  activeVendors: string[];
}

export interface RulesOutcome {
  verdict: Verdict;
  results: RuleResult[];
  projections: Projection[];
  /** The option code would execute, or null if none is acceptable. */
  chosen: PurchaseOption | null;
  /** Cheaper options rejected only because of cash, worth revisiting later. */
  deferred: { option: PurchaseOption; firstBreachWeek: number }[];
  /** True when a person must approve before any card is issued. */
  needsHuman: boolean;
}

const normalise = (s: string) => s.trim().toLowerCase();

