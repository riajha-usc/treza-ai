"use server";

import { revalidatePath } from "next/cache";
import { currentActor } from "@/lib/actor";
import { getApp } from "@/lib/app";
import { resolveDisputeEscalation } from "@/lib/disputes/execute";
import { refundOrder } from "@/lib/disputes/refunds";
import { processDisputes, simulateIssuerRejection, simulateResolution, stageDemoDisputes } from "@/lib/disputes/pipeline";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function stageDemoAction() {
  const { disputes } = await getApp();
  await stageDemoDisputes(disputes);
  revalidatePath("/disputes");
}

export async function syncDisputesAction() {
  const { disputes } = await getApp();
  await processDisputes(disputes);
  revalidatePath("/disputes");
}

export async function issuerRejectsAction(form: FormData) {
  const { disputes } = await getApp();
  await simulateIssuerRejection(disputes, str(form, "disputeId"));
  revalidatePath(`/disputes/${str(form, "disputeId")}`);
}

export async function resolveAction(form: FormData) {
  const { disputes } = await getApp();
  await simulateResolution(disputes, str(form, "disputeId"), str(form, "winner") === "MERCHANT" ? "MERCHANT" : "CUSTOMER");
  revalidatePath(`/disputes/${str(form, "disputeId")}`);
}

export async function decideEscalationAction(form: FormData) {
  const { disputes } = await getApp();
  const choice = str(form, "choice") === "challenge" ? "challenge" : "accept";
  await resolveDisputeEscalation(disputes, str(form, "approvalId"), choice, (await currentActor()).name);
  revalidatePath(`/disputes/${str(form, "disputeId")}`);
}

/** A person refunds the buyer through Airwallex; Treza records it as an order fact. */
export async function refundOrderAction(form: FormData) {
  const { disputes } = await getApp();
  await refundOrder(disputes, str(form, "orderId"), { reason: "Refunded by the dispute analyst", by: (await currentActor()).name, actor: "human" });
  revalidatePath(`/disputes/${str(form, "disputeId")}`);
}
