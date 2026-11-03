import type { CardIssuer, IssuedCard } from "@/lib/airwallex/issuing";
import type { SandboxSimulator, SimulatedAuthorization } from "@/lib/airwallex/simulation";
import type { CardControls } from "@/lib/purchases/controls";
import type { Assessment, ModelResult, PurchaseModel } from "@/lib/models/purchase-model";
import type { ExtractedOption } from "@/lib/purchases/terms";

/** A card issuer that enforces controls the way the builder guide says Airwallex does. */
export class FakeIssuer implements CardIssuer, SandboxSimulator {
  cards = new Map<string, { controls: CardControls; status: string; onBehalfOf?: string; spentAllTime: number; used: number }>();
  calls: { method: string; onBehalfOf?: string; requestId?: string }[] = [];
  private seq = 0;

  async createCardholder(input: { onBehalfOf?: string }) {
    this.calls.push({ method: "createCardholder", onBehalfOf: input.onBehalfOf });
    return { cardholder_id: `ch_${++this.seq}`, status: "PENDING" };
  }
  async findCardholderByEmail() {
    return { cardholder_id: "ch_existing", status: "READY" };
  }
  async getCardholder(id: string) {
    return { cardholder_id: id, status: "READY" };
  }
  async createCard(input: Parameters<CardIssuer["createCard"]>[0]): Promise<IssuedCard> {
    this.calls.push({ method: "createCard", onBehalfOf: input.onBehalfOf, requestId: input.requestId });
    const id = `card_${++this.seq}`;
    this.cards.set(id, { controls: input.controls, status: "ACTIVE", onBehalfOf: input.onBehalfOf, spentAllTime: 0, used: 0 });
    return { card_id: id, card_status: "ACTIVE", card_number: "4035 50** **** 0008" };
  }
  async setCardStatus(cardId: string, status: "ACTIVE" | "INACTIVE" | "CLOSED") {
    this.cards.get(cardId)!.status = status;
    return { card_id: cardId, card_status: status };
  }
  async authorizeCard(input: Parameters<SandboxSimulator["authorizeCard"]>[0]): Promise<SimulatedAuthorization> {
    const card = this.cards.get(input.cardId)!;
    const id = `tx_${++this.seq}`;
    const decline = (failure_reason: string): SimulatedAuthorization => ({ card_transaction_id: id, process_result: "DECLINED", failure_reason });
    if (card.status !== "ACTIVE") return decline("CARD_INACTIVE");
    const c = card.controls;
    if (!c.allowed_currencies.includes(input.currency)) return decline("CURRENCY_NOT_ALLOWED");
    if (!c.allowed_merchant_categories.includes(input.merchantCategoryCode)) return decline("MERCHANT_CATEGORY_NOT_ALLOWED");
    if (c.allowed_transaction_count === "SINGLE" && card.used > 0) return decline("TRANSACTION_BLOCKED");
    for (const l of c.transaction_limits.limits) {
      // Per-transaction limits are inclusive: equal to the limit clears.
      if (l.interval === "PER_TRANSACTION" && input.amount > l.amount) return decline("LIMIT_EXCEEDED");
      if (l.interval === "ALL_TIME" && card.spentAllTime + input.amount > l.amount) return decline("LIMIT_EXCEEDED");
    }
    card.used++;
    card.spentAllTime += input.amount;
    return { card_transaction_id: id, process_result: "APPROVED" };
  }
}

type Behaviour = "approve" | "deny" | "escalate" | "refuse" | "down";

export class FakeModel implements PurchaseModel {
  readonly name = "fake-sonnet";
  extractCalls = 0;
  assessCalls = 0;
  constructor(
    private readonly behaviour: Behaviour = "approve",
    private readonly extracted?: ExtractedOption[],
  ) {}
  private meta() {
    return { model: this.name, promptVersion: "test@1", latencyMs: 5 };
  }
  async extractOptions(): Promise<ModelResult<ExtractedOption[]>> {
    this.extractCalls++;
    if (this.behaviour === "down" || !this.extracted) return { ok: false, reason: "unavailable", detail: "offline", ...this.meta() };
    return { ok: true, value: this.extracted, ...this.meta() };
  }
  async assess(): Promise<ModelResult<Assessment>> {
    this.assessCalls++;
    if (this.behaviour === "refuse") return { ok: false, reason: "refused", detail: "general_harms", ...this.meta() };
    if (this.behaviour === "down") return { ok: false, reason: "unavailable", detail: "offline", ...this.meta() };
    return {
      ok: true,
      value: {
        recommendation: this.behaviour,
        confidence: "high",
        businessPurposeClear: this.behaviour === "approve",
        concerns: [],
        summary: "Shipping software fits an online goods seller.",
      },
      ...this.meta(),
    };
  }
}
