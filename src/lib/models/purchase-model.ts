import type { RuleResult } from "../purchases/rules";
import type { ExtractedOption } from "../purchases/terms";

export interface Assessment {
  recommendation: "approve" | "deny" | "escalate";
  confidence: "low" | "medium" | "high";
  businessPurposeClear: boolean;
  concerns: string[];
  summary: string;
}

export type ModelResult<T> =
  | { ok: true; value: T; model: string; promptVersion: string; latencyMs: number }
  | { ok: false; reason: "refused" | "unavailable" | "invalid"; detail: string; model: string; promptVersion: string; latencyMs: number };

export interface AssessInput {
  tenantName: string;
  vendor: string;
  merchantCategory: string;
  purpose: string;
  chosenOption: string;
  firstChargeMajor: string;
  riskTier: string;
  rules: RuleResult[];
}

/**
 * What the purchase agent needs from a model. The model reads terms and
 * weighs ambiguous requests. It never sets amounts, limits or controls.
 */
export interface PurchaseModel {
  readonly name: string;
  extractOptions(input: { vendor: string; termsText: string; currency: string }): Promise<ModelResult<ExtractedOption[]>>;
  assess(input: AssessInput): Promise<ModelResult<Assessment>>;
}
