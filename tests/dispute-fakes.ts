import { AirwallexError } from "@/lib/airwallex/client";
import type { AirwallexDispute, DisputeGateway, DisputeSimulator } from "@/lib/airwallex/payments";
import type { Fact } from "@/lib/disputes/facts";
import type { DisputeDocument, DisputeModel } from "@/lib/models/dispute-model";
import type { ModelResult } from "@/lib/models/purchase-model";

/** Follows the dispute lifecycle the builder guide describes for the sandbox. */
export class FakeDisputes implements DisputeGateway, DisputeSimulator {
  disputes = new Map<string, AirwallexDispute>();
  intents = new Map<string, { amount: number; currency: string }>();
  challenges: { id: string; body: Record<string, unknown> }[] = [];
  uploads = 0;
  private seq = 0;

  async createPaymentIntent(input: { amount: number; currency: string }) {
    const id = `int_${++this.seq}`;
    this.intents.set(id, input);
    return { id, status: "REQUIRES_PAYMENT_METHOD" };
  }
  async payWithTestCard(id: string) {
    return { id, status: "SUCCEEDED" };
  }
  async createDispute(input: { paymentIntentId: string; reasonCode: string; stage: "RFI" | "CHARGEBACK"; amount: number; dueAt?: string }) {
    const d: AirwallexDispute = {
      id: `dis_${++this.seq}`,
      payment_intent_id: input.paymentIntentId,
      amount: input.amount,
      currency: "USD",
      stage: input.stage,
      status: "REQUIRES_RESPONSE",
      due_at: input.dueAt,
      reason: { original_code: input.reasonCode, type: "FRAUDULENT" },
    };
    this.disputes.set(d.id, d);
    return d;
  }
  async listDisputes() {
    return [...this.disputes.values()].map((d) => ({ ...d }));
  }
  async getDispute(id: string) {
    return { ...this.disputes.get(id)! };
  }
  async acceptDispute(id: string) {
    this.disputes.get(id)!.status = "ACCEPTED";
    return this.getDispute(id);
  }
  async challengeDispute(id: string, body: Record<string, unknown>) {
    this.challenges.push({ id, body });
    this.disputes.get(id)!.status = "CHALLENGED";
    return this.getDispute(id);
  }
  async uploadEvidence() {
    return { file_id: `file_${++this.uploads}` };
  }
  async escalateDispute(id: string) {
    const d = this.disputes.get(id)!;
    if (d.stage === "CHARGEBACK") throw new AirwallexError(400, "validation_error", "Dispute transition is not supported");
    d.stage = "CHARGEBACK";
    d.status = "REQUIRES_RESPONSE";
    return this.getDispute(id);
  }
  async resolveDispute(id: string, inFavorOf: "MERCHANT" | "CUSTOMER") {
    this.disputes.get(id)!.status = inFavorOf === "MERCHANT" ? "WON" : "LOST";
    return this.getDispute(id);
  }
}

/** Reads documents the way a careful model would, plus optional made-up facts. */
export class FakeDisputeModel implements DisputeModel {
  readonly name = "fake-opus";
  constructor(private readonly extra: Fact[] = []) {}
  async extractFacts(input: { documents: DisputeDocument[] }): Promise<ModelResult<Fact[]>> {
    const facts: Fact[] = [...this.extra];
    for (const d of input.documents) {
      const find = (needle: string) => d.body.split("\n").find((l) => l.includes(needle));
      const receipt = find("arrived");
      if (receipt) facts.push({ code: "customer_confirmed_receipt", source: d.id, quote: receipt });
      const asked = find("When will my refund");
      if (asked) facts.push({ code: "customer_contacted_support", source: d.id, quote: asked });
      const returned = find("RETURN DELIVERED");
      if (returned) facts.push({ code: "return_received", source: d.id, quote: returned });
      const replied = find(", Support:");
      if (replied) facts.push({ code: "support_replied", source: d.id, quote: replied });
      const refunded = find("issued your refund");
      if (refunded) facts.push({ code: "refund_issued", source: d.id, quote: refunded });
    }
    return { ok: true, value: facts, model: this.name, promptVersion: "test@1", latencyMs: 5 };
  }
}
