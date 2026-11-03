import { getApp } from "../app";
import { listApprovals } from "../approvals/approvals";
import { sweepExpiredApprovals } from "../approvals/sweep";
import { listAudit, type Actor } from "../audit/audit";
import { loadRiskTier, PolicySchema } from "../purchases/policy";

async function tenantNames() {
  const { db } = await getApp();
  return new Map((await db.query<{ id: string; name: string }>("SELECT id, name FROM tenants")).map((t) => [t.id, t.name]));
}

export async function loadApprovals() {
  const { db } = await getApp();
  await sweepExpiredApprovals(db);
  const [rows, names] = await Promise.all([listApprovals(db), tenantNames()]);
  return rows.map((a) => ({ ...a, tenantName: names.get(a.tenant_id) ?? a.tenant_id }));
}

export async function loadAuditLog(actor?: Actor) {
  const { db } = await getApp();
  const [rows, names] = await Promise.all([listAudit(db, { actor, limit: 200 }), tenantNames()]);
  return rows.map((a) => ({ ...a, tenantName: a.tenant_id ? (names.get(a.tenant_id) ?? a.tenant_id) : null }));
}

export type JournalEntry = {
  id: string;
  kind: string;
  description: string;
  created_at: string;
  postings: { tenant: string; code: string; amount_minor: number; currency: string }[];
};

/** The most recent journal entries with every posting, debits positive and credits negative. */
export async function loadJournal(): Promise<JournalEntry[]> {
  const { db } = await getApp();
  return db.query<JournalEntry>(
    `SELECT e.id, e.kind, e.description, e.created_at,
            json_agg(json_build_object('tenant', t.name, 'code', a.code, 'amount_minor', p.amount_minor, 'currency', p.currency) ORDER BY p.amount_minor DESC) AS postings
     FROM journal_entries e
     JOIN postings p ON p.entry_id = e.id
     JOIN ledger_accounts a ON a.id = p.account_id
     JOIN tenants t ON t.id = a.tenant_id
     GROUP BY e.id ORDER BY e.created_at DESC LIMIT 50`,
  );
}

export async function loadPolicies() {
  const { db } = await getApp();
  const rows = await db.query<{ tenant_id: string; name: string; kind: string; policy: unknown; updated_at: string }>(
    "SELECT p.tenant_id, t.name, t.kind, p.policy, p.updated_at FROM tenant_policies p JOIN tenants t ON t.id = p.tenant_id ORDER BY t.kind = 'platform' DESC, t.name",
  );
  return Promise.all(rows.map(async (r) => ({ ...r, policy: PolicySchema.parse(r.policy), risk: await loadRiskTier(db, r.tenant_id) })));
}

export async function loadReconciliationRuns() {
  const { db } = await getApp();
  return db.query<{ id: string; ok: boolean; findings: string[]; created_at: string }>("SELECT * FROM reconciliation_runs ORDER BY created_at DESC LIMIT 50");
}
