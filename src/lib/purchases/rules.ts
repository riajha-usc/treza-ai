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

/**
 * The deterministic first tier. Clear violations are denied, clean small
 * requests are approved, and anything ambiguous is flagged for review.
 * The model is never asked a question these rules can answer.
 */
export function evaluateRules(input: RulesInput): RulesOutcome {
  const { policy } = input;
  const results: RuleResult[] = [];
  const add = (code: string, outcome: RuleResult["outcome"], detail: string) => results.push({ code, outcome, detail });

  const currencyOk = input.options.every((o) => o.currency === policy.currency);
  add(
    "currency",
    currencyOk ? "pass" : "fail",
    currencyOk ? `All options are in ${policy.currency}` : `Policy only allows ${policy.currency}`,
  );

  const blocked = policy.blockedVendors.some((v) => normalise(v) === normalise(input.vendor));
  add("vendor_allowed", blocked ? "fail" : "pass", blocked ? `${input.vendor} is on the blocked list` : "Vendor is not blocked");

  const mccOk = policy.allowedMerchantCategories.includes(input.merchantCategoryCode);
  add(
    "merchant_category",
    mccOk ? "pass" : "fail",
    mccOk
      ? `Category ${input.merchantCategoryCode} is allowed`
      : `Category ${input.merchantCategoryCode} is outside this tenant's allowed categories`,
  );

  const restricted = input.risk.tier === "restricted";
  add(
    "tenant_risk",
    restricted ? "fail" : input.risk.tier === "low" ? "pass" : "flag",
    restricted
      ? "Tenant is restricted: no new spend"
      : `Tenant risk is ${input.risk.tier}${input.risk.reasons.length ? `: ${input.risk.reasons.join("; ")}` : ""}`,
  );

  // Test every option against the reserve floor over the projection window.
  const projections = input.options.map((option) =>
    projectCash({
      startingBalanceMinor: input.cash.startingBalanceMinor,
      flows: input.cash.flows,
      weeks: policy.projectionWeeks,
      reserveFloorMinor: policy.reserveFloorMinor,
      option,
    }),
  );
  const affordable = input.options.filter((_, i) => projections[i].firstBreachWeek === null);

  // Risk shrinks the largest single charge the tenant may make.
  const capMinor = Math.floor(policy.maxChargeMinor * RISK_CAP_MULTIPLIER[input.risk.tier]);
  const withinCap = affordable.filter((o) => o.chargeMinor <= capMinor);
  if (affordable.length > withinCap.length) {
    add("charge_cap", "flag", `Risk tier ${input.risk.tier} caps any single charge at ${capMinor} minor units`);
  }

  // Among options that keep cash above the floor, choose the cheapest over a year.
  const byCost = [...withinCap].sort((a, b) => costOverMonths(a, 12) - costOverMonths(b, 12));
  const chosen = byCost[0] ?? null;
  const deferred = input.options
    .map((option, i) => ({ option, firstBreachWeek: projections[i].firstBreachWeek }))
    .filter(
      (d): d is { option: PurchaseOption; firstBreachWeek: number } =>
        d.firstBreachWeek !== null && (!chosen || costOverMonths(d.option, 12) < costOverMonths(chosen, 12)),
    );

  if (chosen) {
    add("reserve_floor", "pass", `${chosen.label} keeps cash above the reserve floor for ${policy.projectionWeeks} weeks`);
  } else {
    add("reserve_floor", "fail", "Every option pushes cash below the reserve floor or above the risk cap");
  }
  for (const d of deferred) {
    add("reserve_floor", "info", `${d.option.label} is cheaper but breaches the reserve floor in week ${d.firstBreachWeek}`);
  }

  const duplicate = input.activeVendors.some((v) => normalise(v) === normalise(input.vendor));
  if (duplicate) add("duplicate", "flag", `An active card for ${input.vendor} already exists`);

  const purposeClear = input.purpose.trim().split(/\s+/).length >= 4;
  add("purpose", purposeClear ? "pass" : "flag", purposeClear ? "Business purpose stated" : "Business purpose is too vague");

  const firstCharge = chosen?.chargeMinor ?? 0;
  if (chosen) {
    add(
      "amount",
      firstCharge <= policy.autoApproveMaxMinor ? "pass" : "flag",
      firstCharge <= policy.autoApproveMaxMinor ? "Within the auto-approval limit" : "Above the auto-approval limit",
    );
  }

  const hardFail = results.some((r) => r.outcome === "fail");
  const flagged = results.some((r) => r.outcome === "flag");
  const verdict: Verdict = hardFail || !chosen ? "deny" : flagged ? "review" : "approve";
  const needsHuman =
    verdict !== "deny" && (firstCharge >= policy.humanApprovalFromMinor || input.risk.tier === "high");

  return { verdict, results, projections, chosen: verdict === "deny" ? null : chosen, deferred, needsHuman };
}
