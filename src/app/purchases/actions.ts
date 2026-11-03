"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentActor } from "@/lib/actor";
import { getApp } from "@/lib/app";
import { agentCheckout, type CheckoutMode } from "@/lib/visa/agent-checkout";
import { issueCardForPurchase, resolvePurchase, setCardFrozen, simulateCharge, submitPurchase } from "@/lib/purchases/agent";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function submitPurchaseAction(form: FormData) {
  const { purchases } = await getApp();
  const row = await submitPurchase(purchases, {
    tenantId: str(form, "tenantId"),
    requester: str(form, "requester") || (await currentActor()).name,
    vendor: str(form, "vendor"),
    merchantCategoryCode: str(form, "mcc"),
    purpose: str(form, "purpose"),
    termsText: str(form, "terms"),
    currency: "USD",
  });
  revalidatePath("/purchases");
  redirect(`/purchases/${row.id}`);
}

export async function resolvePurchaseAction(form: FormData) {
  const { purchases } = await getApp();
  const decision = str(form, "decision") === "approved" ? "approved" : "rejected";
  const row = await resolvePurchase(purchases, str(form, "approvalId"), { decision, by: (await currentActor()).name, note: str(form, "note") || undefined });
  revalidatePath(`/purchases/${row.id}`);
}

export async function simulateChargeAction(form: FormData) {
  const { purchases } = await getApp();
  await simulateCharge(purchases, str(form, "cardId"), {
    amountMinor: Number(str(form, "amountMinor")),
    currency: "USD",
    merchantCategoryCode: str(form, "mcc"),
    label: str(form, "label"),
  });
  revalidatePath(`/purchases/${str(form, "purchaseId")}`);
}

export async function freezeCardAction(form: FormData) {
  const { purchases } = await getApp();
  const frozen = str(form, "frozen") === "true";
  await setCardFrozen(purchases, str(form, "cardId"), frozen, {
    actor: "human",
    reason: frozen ? "Frozen by operator" : "Unfrozen by operator",
  });
  revalidatePath(`/purchases/${str(form, "purchaseId")}`);
}

export async function issueCardAction(form: FormData) {
  const { purchases } = await getApp();
  const row = await issueCardForPurchase(purchases, str(form, "purchaseId"));
  revalidatePath(`/purchases/${row.id}`);
}

export async function agentCheckoutAction(form: FormData) {
  const { purchases, visa } = await getApp();
  const mode = str(form, "mode") as CheckoutMode;
  await agentCheckout({ purchases, ...visa }, str(form, "purchaseId"), mode);
  revalidatePath(`/purchases/${str(form, "purchaseId")}`);
}
