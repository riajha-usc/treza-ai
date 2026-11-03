"use server";

import { revalidatePath } from "next/cache";
import { getApp } from "@/lib/app";
import { decideBridges, repayBridges, requestBridge } from "@/lib/settlement/bridging";
import { runSettlementCycle } from "@/lib/settlement/cycle";
import { DEMO_BRIDGE_REQUESTS, DEMO_CARRIER_FAILURE, DEMO_CYCLE_SALES } from "@/lib/settlement/demo";
import { reportCarrierFailure } from "@/lib/settlement/exposure";
import { onboardSellers } from "@/lib/settlement/onboard";
import { reconcileCycle } from "@/lib/settlement/reconcile";

const done = () => revalidatePath("/sellers");

export async function onboardAction() {
  await onboardSellers((await getApp()).settlement);
  done();
}

export async function runCycleAction() {
  const { settlement } = await getApp();
  const id = `cycle_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
  await runSettlementCycle(settlement, id, DEMO_CYCLE_SALES);
  await reconcileCycle(settlement, id);
  done();
}

export async function carrierFailureAction() {
  await reportCarrierFailure((await getApp()).settlement, DEMO_CARRIER_FAILURE);
  done();
}

export async function bridgeRequestsAction() {
  const { settlement } = await getApp();
  for (const r of DEMO_BRIDGE_REQUESTS) await requestBridge(settlement, r);
  await decideBridges(settlement);
  done();
}

export async function lumenDepositAction() {
  await repayBridges((await getApp()).settlement, "seller_lumen", 300_000);
  done();
}

export async function reconcileAction(form: FormData) {
  await reconcileCycle((await getApp()).settlement, String(form.get("cycleId")));
  done();
}
