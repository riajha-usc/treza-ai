import { format } from "../money/money";
import type { RiskTier } from "../purchases/policy";

export interface ReservePolicy {
  /** Reserve this many times the seller's trailing refund rate. */
  refundMultiplier: number;
  /** Sellers younger than this get the new-seller premium. */
  newSellerDays: number;
  newSellerPremiumBps: number;
  riskPremiumBps: Record<RiskTier, number>;
  minRateBps: number;
  maxRateBps: number;
}

export const DEFAULT_RESERVE_POLICY: ReservePolicy = {
  refundMultiplier: 2.5,
  newSellerDays: 90,
  newSellerPremiumBps: 1_000,
  riskPremiumBps: { low: 0, elevated: 500, high: 1_500, restricted: 10_000 },
  minRateBps: 200,
  maxRateBps: 5_000,
};

export interface ReserveInput {
  currency: string;
  grossMinor: number;
  trailingRefundRateBps: number;
  accountAgeDays: number;
  riskTier: RiskTier;
  /** Open chargebacks are held in full until they resolve. */
  openDisputesMinor: number;
  /** Known exposure from new evidence, such as undelivered orders. */
  exposureMinor: number;
}

export interface ReserveResult {
  rateBps: number;
  targetMinor: number;
  explanation: string[];
}

const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

/**
 * Sets one seller's reserve. Pure arithmetic with a written reason for
 * every term, so an operator or a seller can see exactly why money is held.
 */
export function computeReserve(input: ReserveInput, policy: ReservePolicy = DEFAULT_RESERVE_POLICY): ReserveResult {
  const lines: string[] = [];
  if (input.riskTier === "restricted") {
    lines.push("Risk tier restricted: the whole cycle is held until risk is reviewed");
    return { rateBps: 10_000, targetMinor: input.grossMinor + input.openDisputesMinor + input.exposureMinor, explanation: lines };
  }
  let rate = Math.round(input.trailingRefundRateBps * policy.refundMultiplier);
  lines.push(`Trailing refund rate ${pct(input.trailingRefundRateBps)} times ${policy.refundMultiplier} = ${pct(rate)}`);
  if (input.accountAgeDays < policy.newSellerDays) {
    rate += policy.newSellerPremiumBps;
    lines.push(`New seller (${input.accountAgeDays} days): +${pct(policy.newSellerPremiumBps)}`);
  }
  const risk = policy.riskPremiumBps[input.riskTier];
  if (risk) {
    rate += risk;
    lines.push(`Risk tier ${input.riskTier}: +${pct(risk)}`);
  }
  const clamped = Math.min(policy.maxRateBps, Math.max(policy.minRateBps, rate));
  if (clamped !== rate) lines.push(`Rate kept within ${pct(policy.minRateBps)} to ${pct(policy.maxRateBps)}`);
  let target = Math.round((input.grossMinor * clamped) / 10_000);
  lines.push(`${pct(clamped)} of ${format(input.grossMinor, input.currency)} gross = ${format(target, input.currency)}`);
  if (input.openDisputesMinor) {
    target += input.openDisputesMinor;
    lines.push(`Open chargebacks held in full: +${format(input.openDisputesMinor, input.currency)}`);
  }
  if (input.exposureMinor) {
    target += input.exposureMinor;
    lines.push(`Known exposure from new evidence: +${format(input.exposureMinor, input.currency)}`);
  }
  return { rateBps: clamped, targetMinor: target, explanation: lines };
}
