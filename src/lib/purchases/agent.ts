import { AirwallexError } from "../airwallex/client";
import { onceForOperation } from "../airwallex/idempotency";
import type { CardIssuer } from "../airwallex/issuing";
import type { SandboxSimulator } from "../airwallex/simulation";
import { requestApproval, resolveApproval } from "../approvals/approvals";
import { PURCHASE_APPROVAL_HOURS } from "../approvals/sweep";
import { recordDecision } from "../audit/audit";
import type { Db, Queryable } from "../db/client";
import { emit } from "../events/bus";
import { PLATFORM_ACCOUNTS } from "../ledger/accounts";
import { postEntry } from "../ledger/ledger";
import { PLATFORM_TENANT_ID } from "../tenancy";
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
  const email = `cards+${tenantId}@example.com`;
  let holder: { cardholder_id: string; status: string };
  try {
    holder = await deps.issuer!.createCardholder({ email, firstName: tenantName.split(" ")[0] ?? "Treza", lastName: "Delegate", onBehalfOf });
  } catch (err) {
    // A cardholder created by an earlier run, for example with a fresh database, is reused.
    const existing = err instanceof AirwallexError && /already associated/i.test(err.message) ? await deps.issuer!.findCardholderByEmail(email, onBehalfOf) : null;
    if (!existing) throw err;
    holder = existing;
  }
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

/**
 * Issues the card for an approved purchase. Before any money-moving call it
 * checks that the approved terms are untouched and that conditions such as
 * tenant risk have not changed since the decision.
 */
export async function issueCardForPurchase(deps: PurchaseDeps, purchaseId: string): Promise<PurchaseRow> {
  const { db } = deps;
  const req = await getPurchase(db, purchaseId);
  // A purchase whose card issuance failed can be retried: its approval and fingerprint still stand.
  const retry = req.status === "failed" && Boolean(req.decision.controls && req.fingerprint);
  if (req.status !== "approved" && !retry) throw new PurchaseError(`Purchase ${purchaseId} is ${req.status}, not approved`);
  if (retry) await update(db, purchaseId, { status: "approved" });
  const { chosen, controls } = req.decision;
  if (!chosen || !controls) throw new PurchaseError(`Purchase ${purchaseId} has no chosen option`);

  const refuse = async (reason: string) => {
    await update(db, purchaseId, { status: "denied", decision: { ...req.decision, summary: `Not issued: ${reason}` } });
    await recordDecision(db, {
      tenantId: req.tenant_id,
      actor: "system",
      action: "card.issue_refused",
      subjectType: "purchase_request",
      subjectId: purchaseId,
      outcome: { reason },
    });
    return getPurchase(db, purchaseId);
  };

  // The approval covers exactly these terms, or nothing.
  const expected = fingerprint(bindingTerms(req, chosen, controls));
  if (expected !== req.fingerprint) return refuse("the terms changed after the decision");
  if (req.approval_id) {
    const [appr] = await db.query<{ payload: { fingerprint?: string }; status: string }>(
      "SELECT payload, status FROM approvals WHERE id = $1",
      [req.approval_id],
    );
    if (appr?.status !== "approved" || appr.payload.fingerprint !== expected) {
      return refuse("the approval does not cover these terms");
    }
  }

  // Re-check live conditions: a new dispute can change risk after approval.
  const { outcome } = await runRules(db, req, req.options);
  if (outcome.verdict === "deny" || outcome.chosen?.id !== chosen.id) {
    return refuse("conditions changed since approval: " + outcome.results.filter((r) => r.outcome === "fail" || r.outcome === "flag").map((r) => r.detail).join("; "));
  }

  if (!deps.issuer) {
    await update(db, purchaseId, {
      decision: { ...req.decision, issuanceNote: "Approved. The card will be issued once Airwallex credentials are configured." },
    });
    return getPurchase(db, purchaseId);
  }

  const tenant = await tenantInfo(db, req.tenant_id);
  const onBehalfOf = tenant.airwallex_account_id ?? undefined;
  try {
    const cardholderId = await ensureCardholder(deps, req.tenant_id, tenant.name, onBehalfOf);
    const { result: card } = await onceForOperation(
      db,
      { key: `card:${purchaseId}`, tenantId: req.tenant_id, method: "POST", path: "/api/v1/issuing/cards/create" },
      (requestId) =>
        deps.issuer!.createCard({
          requestId,
          cardholderId,
          createdBy: req.requester,
          nickName: `${req.vendor} ${chosen.billing}`,
          controls,
          metadata: { tenant_id: req.tenant_id, purchase_request_id: purchaseId },
          onBehalfOf,
        }),
    );
    await db.query(
      `INSERT INTO cards (tenant_id, purchase_request_id, airwallex_card_id, status, controls, masked_number, on_behalf_of)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (airwallex_card_id) DO NOTHING`,
      [req.tenant_id, purchaseId, card.card_id, card.card_status ?? "PENDING", JSON.stringify(controls), card.card_number ?? null, onBehalfOf ?? null],
    );
    await update(db, purchaseId, { status: "card_issued", decision: { ...(await getPurchase(db, purchaseId)).decision, issuanceNote: undefined } });
    await recordDecision(db, {
      tenantId: req.tenant_id,
      actor: "system",
      action: "card.issued",
      subjectType: "purchase_request",
      subjectId: purchaseId,
      inputs: { onBehalfOf: onBehalfOf ?? null },
      outcome: { cardId: card.card_id, controls },
    });
    await emit(db, { key: `card.issued:${card.card_id}`, type: "card.issued", tenantId: req.tenant_id, payload: { purchaseId, cardId: card.card_id } });
  } catch (err) {
    const message = err instanceof AirwallexError ? `${err.code}: ${err.message}` : String(err);
    await update(db, purchaseId, { status: "failed", decision: { ...req.decision, issuanceNote: `Card issuance failed: ${message}` } });
    await recordDecision(db, {
      tenantId: req.tenant_id,
      actor: "system",
      action: "card.issue_failed",
      subjectType: "purchase_request",
      subjectId: purchaseId,
      outcome: { error: message },
    });
  }
  return getPurchase(db, purchaseId);
}

/** Step 1: read the options from the vendor terms, verified against the text. */
async function readOptions(deps: PurchaseDeps, id: string, input: PurchaseInput) {
  if (input.options) {
    return { options: input.options, extraction: { source: "provided" as const, rejected: [] } };
  }
  let extracted = null;
  let source: "claude" | "rules" = "rules";
  if (deps.model) {
    const res = await deps.model.extractOptions({ vendor: input.vendor, termsText: input.termsText, currency: input.currency });
    await recordDecision(deps.db, {
      tenantId: input.tenantId,
      actor: "model",
      action: "purchase.terms_read",
      subjectType: "purchase_request",
      subjectId: id,
      model: res.model,
      promptVersion: res.promptVersion,
      latencyMs: res.latencyMs,
      outcome: res.ok ? { options: res.value.length } : { failed: res.reason, detail: res.detail },
    });
    if (res.ok) {
      extracted = res.value;
      source = "claude";
    }
  }
  extracted ??= parseTermsWithRules(input.termsText, input.currency);
  const verified = verifyExtracted(input.termsText, extracted);
  return { options: verified.options, extraction: { source, rejected: verified.rejected } };
}

/** Step 3: the model weighs only what the rules flagged. */
async function reviewWithModel(
  deps: PurchaseDeps,
  id: string,
  input: PurchaseInput,
  ctx: { tenantName: string; chosen: PurchaseOption; riskTier: string; rules: RulesOutcome["results"] },
): Promise<{ verdict?: "approve" | "deny"; needsHuman: boolean; assessment: Assessment | null; issue: string | null }> {
  if (!deps.model) {
    return { needsHuman: true, assessment: null, issue: "Claude is not configured, so a person reviews this request." };
  }
  const res = await deps.model.assess({
    tenantName: ctx.tenantName,
    vendor: input.vendor,
    merchantCategory: `${input.merchantCategoryCode} ${categoryName(input.merchantCategoryCode)}`,
    purpose: input.purpose,
    chosenOption: ctx.chosen.label,
    firstChargeMajor: format(ctx.chosen.chargeMinor, ctx.chosen.currency),
    riskTier: ctx.riskTier,
    rules: ctx.rules,
  });
  await recordDecision(deps.db, {
    tenantId: input.tenantId,
    actor: "model",
    action: "purchase.assessed",
    subjectType: "purchase_request",
    subjectId: id,
    model: res.model,
    promptVersion: res.promptVersion,
    latencyMs: res.latencyMs,
    reasoningSummary: res.ok ? res.value.summary : null,
    outcome: res.ok ? { ...res.value } : { failed: res.reason, detail: res.detail },
  });
  if (!res.ok) return { needsHuman: true, assessment: null, issue: `Model ${res.reason}: a person reviews instead.` };
  const a = res.value;
  if (a.recommendation === "deny" && a.confidence === "high") return { verdict: "deny", needsHuman: false, assessment: a, issue: null };
  if (a.recommendation === "approve" && a.confidence !== "low") return { verdict: "approve", needsHuman: false, assessment: a, issue: null };
  return { needsHuman: true, assessment: a, issue: null };
}

/**
 * Takes one purchase request through every tier: read the terms, apply the
 * rules, ask the model only about what rules cannot settle, then route to a
 * person or issue a card whose controls enforce the decision.
 */
export async function submitPurchase(deps: PurchaseDeps, input: PurchaseInput): Promise<PurchaseRow> {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const tenant = await tenantInfo(db, input.tenantId);
  const [{ id }] = await db.query<{ id: string }>(
    `INSERT INTO purchase_requests (tenant_id, requester, vendor, merchant_category_code, purpose, terms_text, currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [input.tenantId, input.requester, input.vendor, input.merchantCategoryCode, input.purpose, input.termsText, input.currency],
  );
  await recordDecision(db, {
    tenantId: input.tenantId,
    actor: "system",
    action: "purchase.received",
    subjectType: "purchase_request",
    subjectId: id,
    inputs: { requester: input.requester, vendor: input.vendor, mcc: input.merchantCategoryCode },
  });

  const { options, extraction } = await readOptions(deps, id, input);
  if (options.length === 0) {
    await update(db, id, { status: "failed", decision: { summary: "No price could be read from the vendor terms.", extraction } });
    return getPurchase(db, id);
  }
  await update(db, id, { options });

  // Step 2: deterministic rules.
  const req = { id, tenant_id: input.tenantId, vendor: input.vendor, merchant_category_code: input.merchantCategoryCode, purpose: input.purpose, currency: input.currency };
  const { policy, risk, outcome } = await runRules(db, req, options);
  await recordDecision(db, {
    tenantId: input.tenantId,
    actor: "rules",
    action: `purchase.rules_${outcome.verdict}`,
    subjectType: "purchase_request",
    subjectId: id,
    inputs: { riskTier: risk.tier, options: options.map((o) => o.id) },
    outcome: { verdict: outcome.verdict, chosen: outcome.chosen?.id ?? null, results: outcome.results },
  });

  let verdict: "approve" | "deny" | "review" = outcome.verdict;
  let needsHuman = outcome.needsHuman;
  let review: Awaited<ReturnType<typeof reviewWithModel>> | null = null;
  if (verdict === "review" && outcome.chosen) {
    review = await reviewWithModel(deps, id, input, { tenantName: tenant.name, chosen: outcome.chosen, riskTier: risk.tier, rules: outcome.results });
    if (review.verdict) verdict = review.verdict;
    needsHuman = needsHuman || review.needsHuman;
  }

  const { verdict: rulesVerdict, results, projections, deferred } = outcome;
  const decision: PurchaseDecision = {
    summary: "",
    extraction,
    rules: { verdict: rulesVerdict, results, projections, deferred, needsHuman: outcome.needsHuman },
    chosen: outcome.chosen,
    assessment: review?.assessment ?? null,
    assessmentIssue: review?.issue ?? null,
    issuedFor: tenant.airwallex_account_id ? "connected_account" : "platform_account",
  };

  if (verdict === "deny" || !outcome.chosen) {
    decision.summary = review?.assessment && verdict === "deny" ? `Denied: ${review.assessment.summary}` : "Denied by policy rules.";
    await update(db, id, { status: "denied", decision });
    await emit(db, { key: `purchase.decided:${id}`, type: "purchase.denied", tenantId: input.tenantId, payload: { purchaseId: id } });
    return getPurchase(db, id);
  }

  // Step 4: code turns the decision into card controls and binds them.
  const chosen = outcome.chosen;
  const controls = buildCardControls({ option: chosen, merchantCategoryCode: input.merchantCategoryCode, reconsiderAfterDays: policy.reconsiderAfterDays, now: now() });
  decision.controls = controls;
  const fp = fingerprint(bindingTerms(req, chosen, controls));
  const price = `${chosen.label} at ${format(chosen.chargeMinor, chosen.currency)}`;

  if (needsHuman) {
    decision.summary = `${price} needs a person's approval.`;
    const { approvalId } = await requestApproval(db, {
      tenantId: input.tenantId,
      kind: "purchase",
      subjectType: "purchase_request",
      subjectId: id,
      amountMinor: chosen.chargeMinor,
      currency: chosen.currency,
      reason: review?.issue ?? review?.assessment?.summary ?? "Above the human approval threshold or risk requires review",
      payload: { fingerprint: fp, vendor: input.vendor, option: chosen.label },
      requestedBy: input.requester,
      expiresAt: new Date(now().getTime() + PURCHASE_APPROVAL_HOURS * 3_600_000),
    });
    await update(db, id, { status: "pending_approval", decision, fingerprint: fp, approval_id: approvalId });
    await emit(db, { key: `purchase.decided:${id}`, type: "purchase.pending_approval", tenantId: input.tenantId, payload: { purchaseId: id } });
    return getPurchase(db, id);
  }

  decision.summary = `Approved ${price}.`;
  await update(db, id, { status: "approved", decision, fingerprint: fp });
  await emit(db, { key: `purchase.decided:${id}`, type: "purchase.approved", tenantId: input.tenantId, payload: { purchaseId: id } });
  return issueCardForPurchase(deps, id);
}

/** A person approves or rejects a pending purchase. */
export async function resolvePurchase(
  deps: PurchaseDeps,
  approvalId: string,
  r: { decision: "approved" | "rejected"; by: string; note?: string },
): Promise<PurchaseRow> {
  const approval = await resolveApproval(deps.db, approvalId, r);
  const purchaseId = approval.subject_id;
  if (r.decision === "rejected") {
    const row = await getPurchase(deps.db, purchaseId);
    await update(deps.db, purchaseId, { status: "denied", decision: { ...row.decision, summary: `Rejected by ${r.by}.` } });
    return getPurchase(deps.db, purchaseId);
  }
  await update(deps.db, purchaseId, { status: "approved" });
  return issueCardForPurchase(deps, purchaseId);
}

export interface CardRow {
  id: string;
  tenant_id: string;
  purchase_request_id: string | null;
  airwallex_card_id: string;
  status: string;
  controls: CardControls;
  /** Connected account the card was issued on, or null for the platform account. */
  on_behalf_of: string | null;
}

/** Simulates one card authorization in the sandbox and records the outcome. */
export async function simulateCharge(
  deps: PurchaseDeps,
  cardId: string,
  charge: { amountMinor: number; currency: string; merchantCategoryCode: string; label: string },
) {
  if (!deps.simulator) throw new PurchaseError("Sandbox simulation is not configured");
  const { db } = deps;
  const [card] = await db.query<CardRow>("SELECT * FROM cards WHERE id = $1", [cardId]);
  if (!card) throw new PurchaseError(`Unknown card ${cardId}`);
  const res = await deps.simulator.authorizeCard({
    cardId: card.airwallex_card_id,
    amount: toMajor(charge.amountMinor, charge.currency),
    currency: charge.currency,
    merchantCategoryCode: charge.merchantCategoryCode,
    onBehalfOf: card.on_behalf_of ?? undefined,
  });
  const outcome = res.process_result === "APPROVED" ? "accepted" : "declined";
  await db.query(
    `INSERT INTO card_transactions (tenant_id, card_id, airwallex_card_id, airwallex_transaction_id, kind, outcome,
       amount_minor, currency, merchant_category_code, merchant_name, failure_reason, raw)
     VALUES ($1, $2, $3, $4, 'simulated_authorization', $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (airwallex_transaction_id) DO NOTHING`,
    [
      card.tenant_id,
      card.id,
      card.airwallex_card_id,
      res.card_transaction_id,
      outcome,
      charge.amountMinor,
      charge.currency,
      charge.merchantCategoryCode,
      charge.label,
      res.failure_reason ?? null,
      JSON.stringify(res),
    ],
  );
  // A card on the platform's own account spends platform cash, so book it.
  if (outcome === "accepted" && !card.on_behalf_of) await bookPlatformCardSpend(db, res.card_transaction_id, charge.amountMinor, charge.currency, charge.label);
  await recordDecision(db, {
    tenantId: card.tenant_id,
    actor: "system",
    action: `card.charge_${outcome}`,
    subjectType: "card",
    subjectId: card.id,
    inputs: { ...charge },
    outcome: { result: res.process_result, failureReason: res.failure_reason ?? null },
  });
  return { outcome, failureReason: res.failure_reason ?? null };
}

export async function bookPlatformCardSpend(db: Db, transactionId: string, amountMinor: number, currency: string, label: string) {
  await postEntry(db, {
    idempotencyKey: `card-spend:${transactionId}`,
    kind: "card_spend",
    description: `Card spend: ${label}`,
    lines: [
      { tenantId: PLATFORM_TENANT_ID, account: PLATFORM_ACCOUNTS.cardSpend, amountMinor, currency },
      { tenantId: PLATFORM_TENANT_ID, account: PLATFORM_ACCOUNTS.cash, amountMinor: -amountMinor, currency },
    ],
  });
}

/** Freezes or unfreezes a card: the agent revoking or restoring its own authority. */
export async function setCardFrozen(deps: PurchaseDeps, cardId: string, frozen: boolean, by: { actor: "human" | "system"; reason: string }) {
  if (!deps.issuer) throw new PurchaseError("Airwallex is not configured");
  const { db } = deps;
  const [card] = await db.query<CardRow>("SELECT * FROM cards WHERE id = $1", [cardId]);
  if (!card) throw new PurchaseError(`Unknown card ${cardId}`);
  const status = frozen ? "INACTIVE" : "ACTIVE";
  await deps.issuer.setCardStatus(card.airwallex_card_id, status, card.on_behalf_of ?? undefined);
  await db.query("UPDATE cards SET status = $2, updated_at = now() WHERE id = $1", [cardId, status]);
  await recordDecision(db, {
    tenantId: card.tenant_id,
    actor: by.actor,
    action: frozen ? "card.frozen" : "card.unfrozen",
    subjectType: "card",
    subjectId: cardId,
    outcome: { reason: by.reason },
  });
}
