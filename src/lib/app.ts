import Anthropic from "@anthropic-ai/sdk";
import { airwallexFromEnv, type AirwallexClient } from "./airwallex/client";
import { AirwallexCardIssuer } from "./airwallex/issuing";
import { AirwallexDisputeGateway, AirwallexDisputeSimulator } from "./airwallex/payments";
import { AirwallexPlatformGateway, AirwallexPlatformSimulator } from "./airwallex/platform";
import type { SettlementDeps } from "./settlement/deps";
import { seedSellerMetrics } from "./settlement/demo";
import { AirwallexSandboxSimulator } from "./airwallex/simulation";
import { getDb, type Db } from "./db/client";
import { env } from "./env";
import { EventBus } from "./events/bus";
import { onDepositSettled } from "./handlers/deposits";
import { onIssuingTransaction } from "./handlers/issuing";
import type { DisputeDeps } from "./disputes/agent";
import { processDisputes } from "./disputes/pipeline";
import { ClaudeDisputeModel } from "./models/dispute-model";
import { ClaudePurchaseModel } from "./models/claude-purchase-model";
import type { PurchaseDeps } from "./purchases/agent";
import { seedDemo } from "./seed";
import { ensureTenant } from "./ledger/ledger";
import { PLATFORM_TENANT_ID } from "./tenancy";

/** Registers every event handler. The closed loop is assembled here. */
export function buildBus(disputes?: DisputeDeps): EventBus {
  const bus = new EventBus().on("deposit.settled", onDepositSettled);
  if (disputes) {
    // Any dispute webhook triggers a sync, which reads the dispute from the API.
    for (const type of ["requires_response", "accepted", "challenged", "pending_decision", "won", "lost", "reversed", "expired"]) {
      bus.on(`payment_dispute.${type}`, async () => void (await processDisputes(disputes)));
    }
  }
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
  disputes: DisputeDeps;
  settlement: SettlementDeps;
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
      if (process.env.SEED_DEMO !== "false") {
        await seedDemo(db);
        await seedSellerMetrics(db);
      }
      const e = env();
      const airwallex = airwallexFromEnv(e);
      const purchases: PurchaseDeps = {
        db,
        model: e.ANTHROPIC_API_KEY ? new ClaudePurchaseModel(new Anthropic({ apiKey: e.ANTHROPIC_API_KEY })) : null,
        issuer: airwallex ? new AirwallexCardIssuer(airwallex) : null,
        // Simulation only exists in the sandbox.
        simulator: airwallex && e.AIRWALLEX_ENV === "sandbox" ? new AirwallexSandboxSimulator(airwallex) : null,
      };
      const disputes: DisputeDeps = {
        db,
        gateway: airwallex ? new AirwallexDisputeGateway(airwallex) : null,
        simulator: airwallex && e.AIRWALLEX_ENV === "sandbox" ? new AirwallexDisputeSimulator(airwallex) : null,
        // Claude Opus 5.5 on Bedrock when enabled, otherwise on the Claude API.
        model:
          e.BEDROCK_ENABLED && e.AWS_REGION
            ? new ClaudeDisputeModel({ bedrockRegion: e.AWS_REGION })
            : e.ANTHROPIC_API_KEY
              ? new ClaudeDisputeModel({ apiKey: e.ANTHROPIC_API_KEY })
              : null,
      };
      const settlement: SettlementDeps = {
        db,
        gateway: airwallex ? new AirwallexPlatformGateway(airwallex) : null,
        simulator: airwallex && e.AIRWALLEX_ENV === "sandbox" ? new AirwallexPlatformSimulator(airwallex) : null,
      };
      return { db, bus: buildBus(disputes), airwallex, purchases, disputes, settlement };
    })();
  }
  return globalForApp.trezaApp;
}
