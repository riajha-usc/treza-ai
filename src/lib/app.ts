import Anthropic from "@anthropic-ai/sdk";
import { airwallexFromEnv, type AirwallexClient } from "./airwallex/client";
import { AirwallexCardIssuer } from "./airwallex/issuing";
import { AirwallexSandboxSimulator } from "./airwallex/simulation";
import { getDb, type Db } from "./db/client";
import { env } from "./env";
import { EventBus } from "./events/bus";
import { onDepositSettled } from "./handlers/deposits";
import { onIssuingTransaction } from "./handlers/issuing";
import { ClaudePurchaseModel } from "./models/claude-purchase-model";
import type { PurchaseDeps } from "./purchases/agent";
import { seedDemo } from "./seed";
import { ensureTenant } from "./ledger/ledger";
import { PLATFORM_TENANT_ID } from "./tenancy";

/** Registers every event handler. The closed loop is assembled here. */
export function buildBus(): EventBus {
  const bus = new EventBus().on("deposit.settled", onDepositSettled);
  for (const type of [
    "issuing.card_transaction.authorized",
    "issuing.card_transaction.cleared",
    "issuing.card_transaction.declined",
    "issuing.card_transaction.reversed",
    "issuing.transaction.succeeded",
    "issuing.transaction.failed",
  ]) {
    bus.on(type, onIssuingTransaction);
  }
  return bus;
}

export interface App {
  db: Db;
  bus: EventBus;
  airwallex: AirwallexClient | null;
  purchases: PurchaseDeps;
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
      if (process.env.SEED_DEMO !== "false") await seedDemo(db);
      const e = env();
      const airwallex = airwallexFromEnv(e);
      const purchases: PurchaseDeps = {
        db,
        model: e.ANTHROPIC_API_KEY ? new ClaudePurchaseModel(new Anthropic({ apiKey: e.ANTHROPIC_API_KEY })) : null,
        issuer: airwallex ? new AirwallexCardIssuer(airwallex) : null,
        // Simulation only exists in the sandbox.
        simulator: airwallex && e.AIRWALLEX_ENV === "sandbox" ? new AirwallexSandboxSimulator(airwallex) : null,
      };
      return { db, bus: buildBus(), airwallex, purchases };
    })();
  }
  return globalForApp.trezaApp;
}
