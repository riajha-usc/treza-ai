import type { Fact, FactCode } from "./facts";

/** What each Visa reason code needs to be won, and what signals merchant fault. */
interface ReasonRule {
  label: string;
  /** Facts that make a strong case. Each adds weight. */
  supporting: Partial<Record<FactCode, number>>;
  /** Facts that weaken the case, for example a signature-free delivery. */
  weakening: Partial<Record<FactCode, number>>;
  /** Patterns that mean a person should decide, whatever the numbers say. */
  redFlags: { when: FactCode[]; unless?: FactCode[]; reason: string }[];
}

export const REASON_RULES: Record<string, ReasonRule> = {
  "10.4": {
    label: "Fraud: card-absent environment",
    supporting: {
      prior_orders_same_device: 0.3,
      prior_orders_same_ip: 0.2,
      delivery_signed: 0.25,
      delivered_to_billing_address: 0.1,
      customer_confirmed_receipt: 0.3,
      agent_authorization_verified: 0.35,
    },
    weakening: {},
    redFlags: [],
  },
  "13.1": {
    label: "Merchandise or services not received",
    supporting: { delivery_signed: 0.5, tracking_shows_delivered: 0.2, customer_confirmed_receipt: 0.4 },
    weakening: { delivered_without_signature: 0.2 },
    redFlags: [],
  },
  "13.6": {
    label: "Credit not processed",
    supporting: { refund_issued: 0.6 },
    weakening: { return_received: 0.3 },
    redFlags: [
      {
        when: ["customer_contacted_support"],
        unless: ["support_replied"],
        reason: "The customer asked support for help and never got a reply, so the merchant may be at fault",
      },
    ],
  },
};

export interface Assessment {
  reasonLabel: string;
  /** Estimated chance of winning a challenge, from the evidence alone. */
  winProbability: number;
  strength: "strong" | "moderate" | "weak";
  supporting: FactCode[];
  missing: FactCode[];
  redFlags: string[];
}

/** Deterministic scoring. The model finds facts; code decides what they are worth. */
export function assessEvidence(reasonCode: string, facts: Fact[]): Assessment {
  const rule = REASON_RULES[reasonCode];
  const have = new Set(facts.map((f) => f.code));
  if (!rule) {
    return { reasonLabel: `Reason ${reasonCode}`, winProbability: 0.1, strength: "weak", supporting: [], missing: [], redFlags: [`No playbook for reason code ${reasonCode}`] };
  }
  let p = 0.05;
  const supporting: FactCode[] = [];
  const missing: FactCode[] = [];
  for (const [code, w] of Object.entries(rule.supporting) as [FactCode, number][]) {
    if (have.has(code)) {
      p += w;
      supporting.push(code);
    } else missing.push(code);
  }
  for (const [code, w] of Object.entries(rule.weakening) as [FactCode, number][]) if (have.has(code)) p -= w;
  p = Math.max(0.02, Math.min(0.9, p));
  const redFlags = rule.redFlags
    .filter((f) => f.when.every((c) => have.has(c)) && !(f.unless ?? []).some((c) => have.has(c)))
    .map((f) => f.reason);
  return {
    reasonLabel: rule.label,
    winProbability: Math.round(p * 100) / 100,
    strength: p >= 0.6 ? "strong" : p >= 0.35 ? "moderate" : "weak",
    supporting,
    missing,
    redFlags,
  };
}

export interface DisputePolicy {
  /** Fee the merchant pays on a challenged dispute, even after winning. */
  challengeFeeMinor: number;
  /** Accepting more than this needs a person's sign-off. */
  humanAcceptFromMinor: number;
}

export const DEFAULT_DISPUTE_POLICY: DisputePolicy = { challengeFeeMinor: 2_000, humanAcceptFromMinor: 50_000 };

export type DisputeAction = "challenge" | "accept" | "escalate";

export interface Economics {
  amountMinor: number;
  challengeFeeMinor: number;
  /** Expected loss if we accept: the full amount. */
  acceptLossMinor: number;
  /** Expected loss if we challenge: the fee plus the amount times the chance of losing. */
  challengeLossMinor: number;
}

/** Chooses the cheaper path in expected value, unless a red flag needs a person. */
export function decide(input: { amountMinor: number; assessment: Assessment; policy: DisputePolicy }): {
  action: DisputeAction;
  economics: Economics;
  reasons: string[];
} {
  const { amountMinor, assessment, policy } = input;
  const economics: Economics = {
    amountMinor,
    challengeFeeMinor: policy.challengeFeeMinor,
    acceptLossMinor: amountMinor,
    challengeLossMinor: Math.round(policy.challengeFeeMinor + amountMinor * (1 - assessment.winProbability)),
  };
  if (assessment.redFlags.length) return { action: "escalate", economics, reasons: assessment.redFlags };
  if (economics.challengeLossMinor < economics.acceptLossMinor && assessment.strength !== "weak") {
    return { action: "challenge", economics, reasons: [`${assessment.strength} evidence: challenging costs less in expectation than accepting`] };
  }
  const reasons = [
    assessment.strength === "weak" ? "Evidence is weak" : "Challenging costs more in expectation than accepting",
  ];
  if (amountMinor >= policy.humanAcceptFromMinor) {
    return { action: "escalate", economics, reasons: [...reasons, "Accepting this amount needs a person's sign-off"] };
  }
  return { action: "accept", economics, reasons };
}
