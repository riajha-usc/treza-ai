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

async function RequestForm({ example }: { example: boolean }) {
  await connection();
  const tenants = await loadTenants();
  const v = example ? EXAMPLE : null;
  return (
    <Panel
      title="New purchase request"
      action={
        <Link href="/purchases?example=parcelwise" className="font-mono text-xs text-accent-text hover:underline">
          Load example
        </Link>
      }
    >
      <form action={submitPurchaseAction} className="space-y-3" key={example ? "example" : "blank"}>
        <label className="block text-xs text-muted">
          Tenant
          <select name="tenantId" defaultValue={v?.tenantId} className={`${field} mt-1`} required>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.kind === "platform" ? " (platform)" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-muted">
            Requester
            <input name="requester" defaultValue={v?.requester} className={`${field} mt-1`} required />
          </label>
          <label className="block text-xs text-muted">
            Vendor
            <input name="vendor" defaultValue={v?.vendor} className={`${field} mt-1`} required />
          </label>
        </div>
        <label className="block text-xs text-muted">
          Merchant category
          <select name="mcc" defaultValue={v?.mcc ?? "5734"} className={`${field} mt-1`}>
            {Object.entries(MERCHANT_CATEGORIES).map(([code, name]) => (
              <option key={code} value={code}>
                {code} {name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-muted">
          Business purpose
          <textarea name="purpose" defaultValue={v?.purpose} rows={2} className={`${field} mt-1`} required />
        </label>
        <label className="block text-xs text-muted">
          Vendor terms or quote
          <textarea name="terms" defaultValue={v?.terms} rows={6} className={`${field} mt-1 font-mono text-xs`} required />
        </label>
        <button type="submit" className="w-full rounded-lg border border-accent-line bg-accent px-4 py-2 text-sm font-medium text-accent-text hover:opacity-90">
          Submit for decision
        </button>
      </form>
    </Panel>
  );
}

async function RequestList() {
  await connection();
  const rows = await loadPurchaseList();
  return (
    <Panel title="Requests">
      {rows.length === 0 ? (
        <Empty>No requests yet. Load the example and submit it to see the full decision trace.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/purchases/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:opacity-80">
                <div>
                  <p className="text-sm font-medium">{r.vendor}</p>
                  <p className="text-xs text-muted">
                    {r.tenant_name} · {r.decision.chosen ? `${r.decision.chosen.label}, ${format(r.decision.chosen.chargeMinor, r.decision.chosen.currency)}` : r.decision.summary || "Processing"}
                  </p>
                </div>
                <StatusChip status={r.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
