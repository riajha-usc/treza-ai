import { getApp } from "../app";
import { sweepExpiredApprovals } from "../approvals/sweep";
import type { ApprovalRow } from "../approvals/approvals";
import { listAudit } from "../audit/audit";
import { getPurchase, type CardRow, type PurchaseRow } from "../purchases/agent";
import { loadPolicy } from "../purchases/policy";

export async function loadTenants() {
  const { db } = await getApp();
  return db.query<{ id: string; name: string; kind: string; airwallex_account_id: string | null }>(
    "SELECT id, name, kind, airwallex_account_id FROM tenants ORDER BY kind = 'platform' DESC, name",
  );
}

export async function loadPurchaseList() {
  const { db } = await getApp();
  return db.query<PurchaseRow & { tenant_name: string }>(
    `SELECT pr.*, t.name AS tenant_name FROM purchase_requests pr JOIN tenants t ON t.id = pr.tenant_id
     ORDER BY pr.created_at DESC LIMIT 100`,
  );
}

export async function loadPurchaseDetail(id: string) {
  const { db, purchases } = await getApp();
  await sweepExpiredApprovals(db);
  const row = await getPurchase(db, id);
  const [tenant] = await db.query<{ name: string; airwallex_account_id: string | null }>(
    "SELECT name, airwallex_account_id FROM tenants WHERE id = $1",
    [row.tenant_id],
  );
  const cards = await db.query<CardRow & { masked_number: string | null }>("SELECT * FROM cards WHERE purchase_request_id = $1", [id]);
  const transactions = cards.length
    ? await db.query<{ id: string; outcome: string; amount_minor: number; currency: string; merchant_category_code: string | null; merchant_name: string | null; failure_reason: string | null; occurred_at: string }>(
        "SELECT * FROM card_transactions WHERE card_id = ANY($1::uuid[]) ORDER BY occurred_at DESC",
        [cards.map((c) => c.id)],
      )
    : [];
  const approval = row.approval_id
    ? (await db.query<ApprovalRow>("SELECT * FROM approvals WHERE id = $1", [row.approval_id]))[0]
    : null;
  const audit = await listAudit(db, { subjectId: id });
  const cardAudit = cards.length ? await listAudit(db, { subjectId: cards[0].id }) : [];
  const policy = await loadPolicy(db, row.tenant_id);
  const [instruction] = await db.query<{ instruction_id: string; mandate: Record<string, unknown>; provider: string; credential: { panLastFour: string | null } }>(
    "SELECT * FROM vic_instructions WHERE purchase_request_id = $1 ORDER BY created_at DESC LIMIT 1",
    [id],
  );
  const checkouts = cards.length
    ? await db.query<{ id: string; verified: boolean; checks: { name: string; pass: boolean; detail: string }[]; created_at: string }>(
        "SELECT * FROM agent_checkouts WHERE card_id = $1 ORDER BY created_at DESC LIMIT 3",
        [cards[0].id],
      )
    : [];
  const authorizations = cards.length
    ? await db.query<{ card_transaction_event_id: string; response_status: string; status_reason: string; latency_ms: number; checks: { name: string; pass: boolean; detail: string }[]; created_at: string }>(
        "SELECT * FROM remote_auth_decisions WHERE card_id = $1 ORDER BY created_at DESC LIMIT 3",
        [cards[0].id],
      )
    : [];
  return {
    row,
    tenantName: tenant?.name ?? row.tenant_id,
    connectedAccount: tenant?.airwallex_account_id ?? null,
    cards,
    transactions,
    approval,
    audit: [...audit, ...cardAudit].sort((a, b) => b.id - a.id),
    reserveFloorMinor: policy?.reserveFloorMinor ?? 0,
    canSimulate: Boolean(purchases.simulator),
    visa: { instruction: instruction ?? null, checkouts, authorizations },
    canIssue: Boolean(purchases.issuer),
  };
}

export type PurchaseDetail = Awaited<ReturnType<typeof loadPurchaseDetail>>;
