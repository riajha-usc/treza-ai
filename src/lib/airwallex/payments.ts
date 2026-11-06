import type { AirwallexClient } from "./client";

export interface AirwallexDispute {
  id: string;
  payment_intent_id: string;
  amount: number;
  currency: string;
  stage: string;
  status: string;
  due_at?: string;
  reason?: { type?: string; original_code?: string; description?: string };
}

/** Payment acceptance and dispute calls the dispute agent makes (Kit 04). */
export interface DisputeGateway {
  createPaymentIntent(input: { requestId: string; amount: number; currency: string; merchantOrderId: string }): Promise<{ id: string; status: string }>;
  listDisputes(input?: { paymentIntentId?: string }): Promise<AirwallexDispute[]>;
  getDispute(id: string): Promise<AirwallexDispute>;
  acceptDispute(id: string, input: { requestId: string; reason: string; description: string }): Promise<AirwallexDispute>;
  challengeDispute(id: string, body: Record<string, unknown>): Promise<AirwallexDispute>;
  uploadEvidence(pdf: Uint8Array, filename: string): Promise<{ file_id: string }>;
  createRefund(input: { requestId: string; paymentIntentId: string; amount: number; currency: string; reason: string }): Promise<{ id: string; status: string; amount: number }>;
}

/** Sandbox-only steps: paying with the test card and moving disputes along. */
export interface DisputeSimulator {
  payWithTestCard(paymentIntentId: string, requestId: string): Promise<{ id: string; status: string }>;
  createDispute(input: { paymentIntentId: string; reasonCode: string; stage: "RFI" | "CHARGEBACK"; dueAt: string; amount: number }): Promise<AirwallexDispute>;
  escalateDispute(id: string, dueAt: string): Promise<AirwallexDispute>;
  resolveDispute(id: string, inFavorOf: "MERCHANT" | "CUSTOMER"): Promise<AirwallexDispute>;
}

export class AirwallexDisputeGateway implements DisputeGateway {
  constructor(private readonly client: AirwallexClient) {}

  createPaymentIntent(input: { requestId: string; amount: number; currency: string; merchantOrderId: string }) {
    return this.client.request<{ id: string; status: string }>("POST", "/api/v1/pa/payment_intents/create", {
      body: { request_id: input.requestId, amount: input.amount, currency: input.currency, merchant_order_id: input.merchantOrderId },
    });
  }

  async listDisputes(input: { paymentIntentId?: string } = {}) {
    const res = await this.client.request<{ items: AirwallexDispute[] }>("GET", "/api/v1/pa/payment_disputes", {
      query: { payment_intent_id: input.paymentIntentId, size: 100 },
    });
    return res.items ?? [];
  }

  getDispute(id: string) {
    return this.client.request<AirwallexDispute>("GET", `/api/v1/pa/payment_disputes/${id}`);
  }

  acceptDispute(id: string, input: { requestId: string; reason: string; description: string }) {
    // The builder guide: accept and challenge over REST, not MCP.
    return this.client.request<AirwallexDispute>("POST", `/api/v1/pa/payment_disputes/${id}/accept`, {
      body: { request_id: input.requestId, reason: input.reason, description: input.description },
    });
  }

  createRefund(input: { requestId: string; paymentIntentId: string; amount: number; currency: string; reason: string }) {
    return this.client.request<{ id: string; status: string; amount: number }>("POST", "/api/v1/pa/refunds/create", {
      body: { request_id: input.requestId, payment_intent_id: input.paymentIntentId, amount: input.amount, currency: input.currency, reason: input.reason },
    });
  }

  challengeDispute(id: string, body: Record<string, unknown>) {
    return this.client.request<AirwallexDispute>("POST", `/api/v1/pa/payment_disputes/${id}/challenge`, { body });
  }

  uploadEvidence(pdf: Uint8Array, filename: string) {
    // Evidence must be JPG or PDF; Airwallex rejects PNG.
    return this.client.uploadFile(new Blob([pdf as BlobPart], { type: "application/pdf" }), filename, "Dispute evidence");
  }
}

export class AirwallexDisputeSimulator implements DisputeSimulator {
  constructor(private readonly client: AirwallexClient) {}

  payWithTestCard(paymentIntentId: string, requestId: string) {
    return this.client.request<{ id: string; status: string }>("POST", `/api/v1/pa/payment_intents/${paymentIntentId}/confirm`, {
      body: {
        request_id: requestId,
        // Airwallex's published sandbox test card. Never a real card.
        payment_method: {
          type: "card",
          card: { number: "4035501000000008", expiry_month: "12", expiry_year: "2030", cvc: "737", name: "Test Buyer" },
        },
      },
    });
  }

  createDispute(input: { paymentIntentId: string; reasonCode: string; stage: "RFI" | "CHARGEBACK"; dueAt: string; amount: number }) {
    return this.client.request<AirwallexDispute>("POST", "/api/v1/simulation/pa/payment_disputes/create", {
      body: { payment_intent_id: input.paymentIntentId, reason_code: input.reasonCode, stage: input.stage, due_at: input.dueAt, amount: input.amount },
    });
  }

  escalateDispute(id: string, dueAt: string) {
    return this.client.request<AirwallexDispute>("POST", `/api/v1/simulation/pa/payment_disputes/${id}/escalate`, { body: { due_at: dueAt } });
  }

  resolveDispute(id: string, inFavorOf: "MERCHANT" | "CUSTOMER") {
    return this.client.request<AirwallexDispute>("POST", `/api/v1/simulation/pa/payment_disputes/${id}/resolve`, { body: { in_favor_of: inFavorOf } });
  }
}
