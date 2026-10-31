import { AirwallexError } from "../airwallex/client";
import { onceForOperation } from "../airwallex/idempotency";
import type { CardIssuer } from "../airwallex/issuing";
import type { SandboxSimulator } from "../airwallex/simulation";
import { requestApproval, resolveApproval } from "../approvals/approvals";
import { recordDecision } from "../audit/audit";
import type { Db, Queryable } from "../db/client";
import { emit } from "../events/bus";
import type { Assessment, PurchaseModel } from "../models/purchase-model";
import { format, toMajor } from "../money/money";
import { loadCash } from "./cash";
import { buildCardControls, type CardControls } from "./controls";
import { fingerprint } from "./fingerprint";
import { categoryName } from "./merchant-categories";
import type { PurchaseOption } from "./options";
import { loadPolicy, loadRiskTier } from "./policy";
import { evaluateRules, type RulesOutcome } from "./rules";
import { parseTermsWithRules, verifyExtracted } from "./terms";

export interface PurchaseDeps {
  db: Db;
  model: PurchaseModel | null;
  issuer: CardIssuer | null;
  simulator: SandboxSimulator | null;
  now?: () => Date;
  /** Injected in tests so cardholder polling does not wait. */
  sleep?: (ms: number) => Promise<void>;
}

export interface PurchaseInput {
  tenantId: string;
  requester: string;
  vendor: string;
  merchantCategoryCode: string;
  purpose: string;
  termsText: string;
  currency: string;
  /** Pre-read options. When omitted, the agent reads them from the terms. */
  options?: PurchaseOption[];
}

export type PurchaseStatus = "received" | "pending_approval" | "approved" | "denied" | "card_issued" | "failed";

export interface PurchaseDecision {
  summary: string;
  extraction?: { source: "provided" | "claude" | "rules"; rejected: { label: string; reason: string }[] };
  rules?: Pick<RulesOutcome, "verdict" | "results" | "projections" | "deferred" | "needsHuman">;
  chosen?: PurchaseOption | null;
  assessment?: Assessment | null;
  assessmentIssue?: string | null;
  controls?: CardControls;
  issuedFor?: "connected_account" | "platform_account";
  issuanceNote?: string;
}

export interface PurchaseRow {
  id: string;
  tenant_id: string;
  requester: string;
  vendor: string;
  merchant_category_code: string;
  purpose: string;
  terms_text: string;
  currency: string;
  options: PurchaseOption[];
  decision: PurchaseDecision;
  status: PurchaseStatus;
  fingerprint: string | null;
  approval_id: string | null;
  created_at: string;
  updated_at: string;
}

export class PurchaseError extends Error {}

async function tenantInfo(q: Queryable, tenantId: string) {
  const [t] = await q.query<{ name: string; airwallex_account_id: string | null }>(
    "SELECT name, airwallex_account_id FROM tenants WHERE id = $1",
    [tenantId],
  );
  if (!t) throw new PurchaseError(`Unknown tenant ${tenantId}`);
  return t;
}

async function update(q: Queryable, id: string, fields: Partial<Pick<PurchaseRow, "status" | "fingerprint" | "approval_id">> & { decision?: PurchaseDecision; options?: PurchaseOption[] }) {
  const sets: string[] = ["updated_at = now()"];
  const params: unknown[] = [id];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${params.push(k === "decision" || k === "options" ? JSON.stringify(v) : v)}`);
  }
  await q.query(`UPDATE purchase_requests SET ${sets.join(", ")} WHERE id = $1`, params);
}

export async function getPurchase(q: Queryable, id: string): Promise<PurchaseRow> {
  const [row] = await q.query<PurchaseRow>("SELECT * FROM purchase_requests WHERE id = $1", [id]);
  if (!row) throw new PurchaseError(`Unknown purchase request ${id}`);
  return row;
}

