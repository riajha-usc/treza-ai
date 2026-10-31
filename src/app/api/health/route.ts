import { connection } from "next/server";
import { getApp } from "@/lib/app";
import { env } from "@/lib/env";

/** Setup checklist. Reports which integrations are configured, never their values. */
export async function GET(request: Request) {
  await connection(); // live status, never prerendered at build time
  const e = env();
  const { db, airwallex } = await getApp();
  const [{ ok }] = await db.query<{ ok: number }>("SELECT 1 AS ok");

  let airwallexAuth: "ok" | "not_configured" | string = airwallex ? "unchecked" : "not_configured";
  if (airwallex && new URL(request.url).searchParams.get("check") === "airwallex") {
    try {
      await airwallex.request("GET", "/api/v1/global_accounts", { query: { page_size: 10 } });
      airwallexAuth = "ok";
    } catch (err) {
      airwallexAuth = err instanceof Error ? err.message : "failed";
    }
  }

  return Response.json({
    database: { ok: ok === 1, driver: e.DATABASE_URL ? "postgres" : "pglite" },
    airwallex: { environment: e.AIRWALLEX_ENV, credentials: Boolean(airwallex), auth: airwallexAuth },
    webhooks: { secretConfigured: Boolean(e.AIRWALLEX_WEBHOOK_SECRET) },
    claude: { apiKeyConfigured: Boolean(e.ANTHROPIC_API_KEY) },
    bedrock: { enabled: e.BEDROCK_ENABLED, regionConfigured: Boolean(e.AWS_REGION) },
  });
}
