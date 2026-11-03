import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { StatusChip } from "@/components/status";
import { dateTime } from "@/components/time";
import { Empty, PageHeader, Panel, PanelBody } from "@/components/ui";
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
    <main className="flex flex-col gap-4 p-6">
      <PageHeader
        title="Purchases"
        subtitle="Rules decide the clear cases, Claude Sonnet 5.5 weighs the rest, and each approval becomes a card that enforces it."
      />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          <Suspense fallback={<Panel title="Requests"><Empty>Loading requests...</Empty></Panel>}>
            <RequestList />
          </Suspense>
        </div>
        <div className="xl:w-[380px] xl:flex-none">
          <Suspense fallback={<Panel title="New purchase request"><Empty>Loading form...</Empty></Panel>}>
            {searchParams.then((sp) => (
              <RequestForm example={sp.example === "parcelwise"} />
            ))}
          </Suspense>
        </div>
      </div>
    </main>
  );
}

const label = "flex flex-col gap-1 text-xs font-medium text-muted";

async function RequestForm({ example }: { example: boolean }) {
  await connection();
  const tenants = await loadTenants();
  const v = example ? EXAMPLE : null;
  return (
    <Panel
      title="New purchase request"
      meta={
        <Link href="/purchases?example=parcelwise" className="text-primary hover:underline">
          Load example
        </Link>
      }
    >
      <PanelBody>
        <form action={submitPurchaseAction} className="flex flex-col gap-3" key={example ? "example" : "blank"}>
          <label className={label}>
            Tenant
            <select name="tenantId" defaultValue={v?.tenantId} className="field" required>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.kind === "platform" ? " (platform)" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              Requester
              <input name="requester" defaultValue={v?.requester} className="field" required />
            </label>
            <label className={label}>
              Vendor
              <input name="vendor" defaultValue={v?.vendor} className="field" required />
            </label>
          </div>
          <label className={label}>
            Merchant category
            <select name="mcc" defaultValue={v?.mcc ?? "5734"} className="field">
              {Object.entries(MERCHANT_CATEGORIES).map(([code, name]) => (
                <option key={code} value={code}>
                  {code} {name}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Business purpose
            <textarea name="purpose" defaultValue={v?.purpose} rows={2} className="field" required />
          </label>
          <label className={label}>
            Vendor terms or quote
            <textarea name="terms" defaultValue={v?.terms} rows={6} className="field font-mono text-xs" required />
          </label>
          <button type="submit" className="btn btn-primary justify-center">
            Submit for decision
          </button>
        </form>
      </PanelBody>
    </Panel>
  );
}

async function RequestList() {
  await connection();
  const rows = await loadPurchaseList();
  return (
    <Panel title="Requests" meta={`${rows.length} total`}>
      {rows.length === 0 ? (
        <Empty>No requests yet. Load the example and submit it to see the full decision trace.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr><th>Vendor</th><th>Tenant</th><th>Requested by</th><th>Decision</th><th className="num">Charge</th><th>Status</th><th>Created</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = r.decision.chosen;
                return (
                  <tr key={r.id} className="link">
                    <td>
                      <Link href={`/purchases/${r.id}`} className="font-medium text-primary hover:underline">
                        {r.vendor}
                      </Link>
                    </td>
                    <td>{r.tenant_name}</td>
                    <td>{r.requester}</td>
                    <td className="text-ink-2">{c ? c.label : r.decision.summary || "Processing"}</td>
                    <td className="num">{c ? format(c.chargeMinor, c.currency) : ""}</td>
                    <td><StatusChip status={r.status} /></td>
                    <td className="whitespace-nowrap text-muted">{dateTime(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
