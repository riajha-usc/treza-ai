import { getApp } from "../app";
import { listAudit } from "../audit/audit";
import { listEvents } from "../events/bus";
import { tenantBalances } from "../ledger/ledger";
import { env } from "../env";
import { PLATFORM_TENANT_ID } from "../tenancy";

export async function loadOverview() {
  const e = env();
  const { db, airwallex } = await getApp();
  const [platform] = await db.query<{ name: string }>("SELECT name FROM tenants WHERE id = $1", [PLATFORM_TENANT_ID]);
  const [events, audit, balances] = await Promise.all([
    listEvents(db, { limit: 12 }),
    listAudit(db, { limit: 12 }),
    tenantBalances(db, PLATFORM_TENANT_ID),
  ]);
  return {
    platformName: platform?.name ?? "Platform",
    environment: e.AIRWALLEX_ENV,
    setup: [
      { label: "Ledger database", ok: true, detail: e.DATABASE_URL ? "Postgres" : "Embedded Postgres" },
      { label: "Airwallex credentials", ok: Boolean(airwallex), detail: airwallex ? "Configured" : "Add client ID and API key" },
      { label: "Webhook signing secret", ok: Boolean(e.AIRWALLEX_WEBHOOK_SECRET), detail: e.AIRWALLEX_WEBHOOK_SECRET ? "Configured" : "Add webhook secret" },
      { label: "Claude API", ok: Boolean(e.ANTHROPIC_API_KEY), detail: e.ANTHROPIC_API_KEY ? "Configured" : "Gray-zone purchases go to approvals" },
      { label: "Bedrock", ok: e.BEDROCK_ENABLED, detail: e.BEDROCK_ENABLED ? `Region ${e.AWS_REGION ?? "unset"}` : "Evidence parsing uses Claude API or rules" },
    ],
    events,
    audit,
    balances,
  };
}
