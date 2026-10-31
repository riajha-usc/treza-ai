import { airwallexFromEnv, type AirwallexClient } from "./airwallex/client";
import { getDb, type Db } from "./db/client";
import { env } from "./env";
import { EventBus } from "./events/bus";
import { onDepositSettled } from "./handlers/deposits";
import { ensureTenant } from "./ledger/ledger";
import { PLATFORM_TENANT_ID } from "./tenancy";

/** Registers every event handler. The closed loop is assembled here. */
export function buildBus(): EventBus {
  return new EventBus().on("deposit.settled", onDepositSettled);
}

export interface App {
  db: Db;
  bus: EventBus;
  airwallex: AirwallexClient | null;
}

const globalForApp = globalThis as unknown as { trezaApp?: Promise<App> };

export function getApp(): Promise<App> {
  if (!globalForApp.trezaApp) {
    globalForApp.trezaApp = (async () => {
      const db = await getDb();
      await ensureTenant(db, {
        id: PLATFORM_TENANT_ID,
        kind: "platform",
        name: process.env.PLATFORM_NAME ?? "Meridian Market",
      });
      return { db, bus: buildBus(), airwallex: airwallexFromEnv(env()) };
    })();
  }
  return globalForApp.trezaApp;
}
