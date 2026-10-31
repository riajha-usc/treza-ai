import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { StatusChip } from "@/components/status";
import { Empty, Panel } from "@/components/ui";
import { format } from "@/lib/money/money";
import { MERCHANT_CATEGORIES } from "@/lib/purchases/merchant-categories";
import { loadPurchaseList, loadTenants } from "@/lib/queries/purchases";
import { PARCELWISE_TERMS } from "@/lib/seed";
import { submitPurchaseAction } from "./actions";

const EXAMPLE = {
  tenantId: "seller_lumen",
  requester: "Maya Chen",
  vendor: "Parcelwise",
  mcc: "5734",
  purpose: "Shipping label software to cut fulfilment time for marketplace orders",
  terms: PARCELWISE_TERMS,
};

export default function PurchasesPage({ searchParams }: PageProps<"/purchases">) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Kit 02 and Kit 05</p>
        <h1 className="mt-1 text-2xl font-medium">Intent-bound purchases</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Rules decide the clear cases. Claude Sonnet 5.5 weighs only what rules cannot. Every approved purchase gets a
          virtual card whose limits and merchant lock enforce the decision.
        </p>
      </header>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Suspense fallback={<Empty>Loading form...</Empty>}>
            {searchParams.then((sp) => (
              <RequestForm example={sp.example === "parcelwise"} />
            ))}
          </Suspense>
        </div>
        <div className="lg:col-span-3">
          <Suspense fallback={<Empty>Loading requests...</Empty>}>
            <RequestList />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

const field = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-text placeholder:text-muted focus:border-accent-line focus:outline-none";

