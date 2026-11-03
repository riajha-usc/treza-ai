import { cache } from "react";
import { getApp } from "../app";
import { env } from "../env";
import { PLATFORM_TENANT_ID } from "../tenancy";

/** What the sidebar and top bar need on every page, read once per request. */
export const loadShell = cache(async () => {
  const { db } = await getApp();
  const [[platform], [pending]] = await Promise.all([
    db.query<{ name: string }>("SELECT name FROM tenants WHERE id = $1", [PLATFORM_TENANT_ID]),
    db.query<{ n: number }>("SELECT count(*)::int AS n FROM approvals WHERE status = 'pending'"),
  ]);
  return { platformName: platform?.name ?? "Platform", environment: env().AIRWALLEX_ENV, pendingApprovals: pending?.n ?? 0 };
});
