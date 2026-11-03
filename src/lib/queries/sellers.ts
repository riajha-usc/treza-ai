import { getApp } from "../app";
import { loadRiskTier } from "../purchases/policy";
import { DEFAULT_BRIDGE_POLICY } from "../settlement/bridging";
import { openDisputesMinor, sellerPosition, sellers } from "../settlement/deps";
import { IDENTITIES_ENV, loadSellerIdentities } from "../settlement/onboard";

export async function loadSellers() {
  const { db, settlement } = await getApp();
  const rows = await Promise.all(
    (await sellers(db)).map(async (s) => {
      const [line] = await db.query<{ cycle_id: string; reserve_rate_bps: number; reserve_target_minor: number; payout_minor: number; transfer_status: string | null; explanation: string[] }>(
        "SELECT * FROM settlement_lines WHERE tenant_id = $1 ORDER BY cycle_id DESC LIMIT 1",
        [s.id],
      );
      return {
        seller: s,
        risk: await loadRiskTier(db, s.id),
        position: await sellerPosition(db, s.id),
        openDisputesMinor: Number(await openDisputesMinor(db, s.id)),
        line: line ?? null,
      };
    }),
  );
  const [recon] = await db.query<{ ok: boolean; findings: string[]; created_at: string }>("SELECT * FROM reconciliation_runs ORDER BY created_at DESC LIMIT 1");
  const exposures = await db.query<{ tenant_id: string; kind: string; exposure_minor: number; resolution: Record<string, number>; created_at: string }>(
    "SELECT * FROM exposure_events ORDER BY created_at DESC LIMIT 10",
  );
  const bridges = await db.query<{ id: string; tenant_name: string; amount_minor: number; status: string; purpose: string; decision: { reason?: string }; created_at: string }>(
    "SELECT b.*, t.name AS tenant_name FROM bridges b JOIN tenants t ON t.id = b.tenant_id ORDER BY b.created_at DESC",
  );
  const [cycle] = await db.query<{ id: string }>("SELECT id FROM settlement_cycles WHERE status = 'settled' ORDER BY created_at DESC LIMIT 1");
  return {
    rows,
    reconciliation: recon ?? null,
    exposures,
    bridges,
    bridgePolicy: DEFAULT_BRIDGE_POLICY,
    lastCycleId: cycle?.id ?? null,
    connected: Boolean(settlement.gateway),
    identitiesReady: Boolean(loadSellerIdentities()),
    identitiesEnv: IDENTITIES_ENV,
  };
}
