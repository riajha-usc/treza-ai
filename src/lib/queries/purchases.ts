import { getApp } from "../app";
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
    ? (await db.query<{ id: string; status: string; reason: string; resolved_by: string | null }>("SELECT * FROM approvals WHERE id = $1", [row.approval_id]))[0]
    : null;
  const audit = await listAudit(db, { subjectId: id });
  const cardAudit = cards.length ? await listAudit(db, { subjectId: cards[0].id }) : [];
  const policy = await loadPolicy(db, row.tenant_id);
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
    canIssue: Boolean(purchases.issuer),
  };
}

export type PurchaseDetail = Awaited<ReturnType<typeof loadPurchaseDetail>>;
