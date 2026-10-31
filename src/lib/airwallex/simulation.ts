import type { AirwallexClient } from "./client";

export interface SimulatedAuthorization {
  card_transaction_id: string;
  card_transaction_lifecycle_id?: string;
  process_result: "APPROVED" | "DECLINED";
  failure_reason?: string | null;
}

/**
 * Sandbox-only calls live behind this one interface, as the builder guide
 * recommends, so decision logic never depends on a simulator. In production
 * this is simply not wired.
 */
export interface SandboxSimulator {
  authorizeCard(input: {
    cardId: string;
    amount: number;
    currency: string;
    merchantCategoryCode: string;
    onBehalfOf?: string;
  }): Promise<SimulatedAuthorization>;
}

export class AirwallexSandboxSimulator implements SandboxSimulator {
  constructor(private readonly client: AirwallexClient) {}

  authorizeCard(input: Parameters<SandboxSimulator["authorizeCard"]>[0]) {
    return this.client.request<SimulatedAuthorization>("POST", "/api/v1/simulation/issuing/create", {
      // The guide warns: without x-on-behalf-of a connected account's card
      // simulation reports failure yet still creates the transaction.
      onBehalfOf: input.onBehalfOf,
      body: {
        card_id: input.cardId,
        transaction_amount: input.amount,
        transaction_currency: input.currency,
        merchant_category_code: input.merchantCategoryCode,
        // Authorize and clear in one step so the outcome is final for the demo.
        single_phase: true,
      },
    });
  }
}
