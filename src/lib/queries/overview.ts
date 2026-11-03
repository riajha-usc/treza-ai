import { getApp } from "../app";
import { listApprovals } from "../approvals/approvals";
import { listAudit } from "../audit/audit";
import { env } from "../env";
import { DEFAULT_BRIDGE_POLICY } from "../settlement/bridging";
import { sellerPosition, sellers } from "../settlement/deps";

const one = async <T>(p: Promise<T[]>) => (await p)[0];

export async function loadOverview() {
  const e = env();
  const { db, airwallex } = await getApp();
  const [declined, disputes, payout, bridged, auth, cards, ledger, recon, models, approvals, activity, sellerRows] = await Promise.all([
    one(db.query<{ total: number; n: number }>("SELECT COALESCE(SUM(amount_minor), 0)::bigint AS total, count(*)::int AS n FROM card_transactions WHERE outcome = 'declined'")),
    one(
      db.query<{ defended: number; submitted: number; awaiting: number }>(
        `SELECT COALESCE(SUM(d.amount_minor) FILTER (WHERE s.dispute_id IS NOT NULL), 0)::bigint AS defended,
                count(*) FILTER (WHERE s.dispute_id IS NOT NULL)::int AS submitted,
                count(*) FILTER (WHERE a.subject_id IS NOT NULL)::int AS awaiting
         FROM disputes d
         LEFT JOIN (SELECT DISTINCT dispute_id FROM dispute_submissions WHERE action = 'challenge') s ON s.dispute_id = d.id
         LEFT JOIN approvals a ON a.subject_type = 'dispute' AND a.subject_id = d.id::text AND a.status = 'pending'`,
      ),
    ),
    one(
      db.query<{ paid: number; sellers: number; cycle: string | null }>(
        `SELECT COALESCE(SUM(l.payout_minor), 0)::bigint AS paid, count(l.tenant_id)::int AS sellers, max(c.id) AS cycle
         FROM settlement_cycles c LEFT JOIN settlement_lines l ON l.cycle_id = c.id
         WHERE c.id = (SELECT id FROM settlement_cycles WHERE status = 'settled' ORDER BY created_at DESC LIMIT 1)`,
      ),
    ),
    one(db.query<{ total: number }>("SELECT COALESCE(SUM(amount_minor), 0)::bigint AS total FROM bridges WHERE status = 'funded'")),
    one(db.query<{ median: number | null; n: number }>("SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) AS median, count(*)::int AS n FROM remote_auth_decisions")),
    one(db.query<{ active: number }>("SELECT count(*)::int AS active FROM cards WHERE status = 'ACTIVE'")),
    one(db.query<{ entries: number; imbalance: number }>("SELECT (SELECT count(*)::int FROM journal_entries) AS entries, COALESCE((SELECT SUM(amount_minor) FROM postings), 0)::bigint AS imbalance")),
    one(db.query<{ ok: boolean; created_at: string }>("SELECT ok, created_at FROM reconciliation_runs ORDER BY created_at DESC LIMIT 1")),
    db.query<{ model: string; calls: number; median_ms: number | null }>(
      "SELECT model, count(*)::int AS calls, percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) AS median_ms FROM audit_log WHERE actor = 'model' AND model IS NOT NULL GROUP BY model ORDER BY model",
    ),
    listApprovals(db, { status: "pending" }),
    listAudit(db, { limit: 10 }),
    sellers(db),
  ]);
  const positions = await Promise.all(sellerRows.map((s) => sellerPosition(db, s.id)));
  const tenantNames = new Map((await db.query<{ id: string; name: string }>("SELECT id, name FROM tenants")).map((t) => [t.id, t.name]));
  return {
    figures: {
      declinedMinor: Number(declined.total),
      declines: declined.n,
      defendedMinor: Number(disputes.defended),
      disputesSubmitted: disputes.submitted,
      disputesAwaiting: disputes.awaiting,
      paidMinor: Number(payout.paid),
      sellersPaid: payout.sellers,
      cycle: payout.cycle,
      heldMinor: positions.reduce((sum, p) => sum + p.reserveMinor, 0),
      bridgedMinor: Number(bridged.total),
      facilityMinor: DEFAULT_BRIDGE_POLICY.facilityMinor,
      authMedianMs: auth.median,
      authorizations: auth.n,
      activeCards: cards.active,
    },
    ledger: { entries: ledger.entries, imbalanceMinor: Number(ledger.imbalance), reconciliation: recon ?? null },
    models,
    approvals: approvals.map((a) => ({ ...a, tenantName: tenantNames.get(a.tenant_id) ?? a.tenant_id })),
    activity: activity.map((a) => ({ ...a, tenantName: a.tenant_id ? (tenantNames.get(a.tenant_id) ?? a.tenant_id) : null })),
    setup: [
      { label: "Airwallex credentials", ok: Boolean(airwallex), detail: "Add client ID and API key to .env" },
      { label: "Webhook signing secret", ok: Boolean(e.AIRWALLEX_WEBHOOK_SECRET), detail: "Add AIRWALLEX_WEBHOOK_SECRET" },
      { label: "Claude API", ok: Boolean(e.ANTHROPIC_API_KEY), detail: "Gray-zone purchases go to approvals until ANTHROPIC_API_KEY is set" },
    ].filter((s) => !s.ok),
  };
}
