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

async function activeVendors(q: Queryable, tenantId: string, excludeId?: string): Promise<string[]> {
  const rows = await q.query<{ vendor: string }>(
    `SELECT DISTINCT pr.vendor FROM cards c JOIN purchase_requests pr ON pr.id = c.purchase_request_id
     WHERE c.tenant_id = $1 AND c.status IN ('ACTIVE', 'PENDING') AND pr.id <> COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000')`,
    [tenantId, excludeId ?? null],
  );
  return rows.map((r) => r.vendor);
}

/** Runs the rules against the tenant's current policy, risk and cash. */
async function runRules(q: Queryable, req: Pick<PurchaseRow, "id" | "tenant_id" | "vendor" | "merchant_category_code" | "purpose" | "currency">, options: PurchaseOption[]) {
  const policy = await loadPolicy(q, req.tenant_id);
  if (!policy) throw new PurchaseError(`Tenant ${req.tenant_id} has no spend policy`);
  const [risk, cash, vendors] = await Promise.all([
    loadRiskTier(q, req.tenant_id),
    loadCash(q, req.tenant_id, req.currency),
    activeVendors(q, req.tenant_id, req.id),
  ]);
  const outcome = evaluateRules({
    vendor: req.vendor,
    merchantCategoryCode: req.merchant_category_code,
    purpose: req.purpose,
    options,
    policy,
    risk,
    cash,
    activeVendors: vendors,
  });
  return { policy, risk, outcome };
}

function bindingTerms(req: Pick<PurchaseRow, "tenant_id" | "vendor" | "merchant_category_code">, chosen: PurchaseOption, controls: CardControls) {
  return { tenantId: req.tenant_id, vendor: req.vendor, mcc: req.merchant_category_code, option: chosen, controls };
}

async function ensureCardholder(deps: PurchaseDeps, tenantId: string, tenantName: string, onBehalfOf?: string): Promise<string> {
  const { db } = deps;
  const [existing] = await db.query<{ airwallex_cardholder_id: string }>(
    "SELECT airwallex_cardholder_id FROM cardholders WHERE tenant_id = $1",
    [tenantId],
  );
  if (existing) return existing.airwallex_cardholder_id;
  const holder = await deps.issuer!.createCardholder({
    email: `cards+${tenantId}@example.com`,
    firstName: tenantName.split(" ")[0] ?? "Treza",
    lastName: "Delegate",
    onBehalfOf,
  });
  // Cardholders reach READY within seconds without any approval call.
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let status = holder.status;
  for (let i = 0; i < 10 && status !== "READY"; i++) {
    await sleep(1000);
    status = (await deps.issuer!.getCardholder(holder.cardholder_id, onBehalfOf)).status;
  }
  await db.query(
    `INSERT INTO cardholders (tenant_id, airwallex_cardholder_id, status) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId, holder.cardholder_id, status],
  );
  return holder.cardholder_id;
}

