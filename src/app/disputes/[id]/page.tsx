import { Suspense } from "react";
import { connection } from "next/server";
import { AuditTable } from "@/components/records";
import { date, dateTime } from "@/components/time";
import { Empty, Facts, PageHeader, Panel, PanelBody, Tag } from "@/components/ui";
import { format } from "@/lib/money/money";
import { loadDisputeDetail } from "@/lib/queries/disputes";
import { decideEscalationAction, issuerRejectsAction, resolveAction } from "../actions";
import { STATUS_TONE } from "../tags";
import { DecisionPanel, EvidencePanel } from "./panels";

export default function DisputeDetailPage({ params }: PageProps<"/disputes/[id]">) {
  return (
    <main className="flex flex-col gap-4 p-6">
      <Suspense fallback={<Empty>Loading dispute...</Empty>}>{params.then(({ id }) => <Detail id={id} />)}</Suspense>
    </main>
  );
}

async function Detail({ id }: { id: string }) {
  await connection();
  const d = await loadDisputeDetail(id);
  const { row, order } = d;
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  const challenged = d.submissions.some((s) => s.action === "challenge");
  return (
    <>
      <PageHeader
        title={`${row.order_id ?? "Dispute"} · ${format(row.amount_minor, row.currency)}`}
        status={<Tag tone={STATUS_TONE(row.status)}>{row.stage} · {row.status.replaceAll("_", " ").toLowerCase()}</Tag>}
        subtitle={[row.seller_name, order?.buyer_name, `Airwallex ${row.airwallex_dispute_id}`, row.due_at ? `due ${date(row.due_at)}` : null].filter(Boolean).join(" · ")}
        actions={challenged ? <a href={`/api/disputes/${row.id}/evidence`} className="btn">Evidence PDF</a> : null}
      />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <EvidencePanel d={d} />
          <DecisionPanel d={d} />
          <Panel title="Submissions to Airwallex">
            {d.submissions.length === 0 ? (
              <Empty>Nothing submitted yet.</Empty>
            ) : (
              <table className="tbl">
                <thead><tr><th>Sent</th><th>Action</th><th>Stage</th><th>Documents</th></tr></thead>
                <tbody>
                  {d.submissions.map((s) => (
                    <tr key={s.id}>
                      <td className="whitespace-nowrap text-muted">{dateTime(s.created_at)}</td>
                      <td className="capitalize">{s.action}</td>
                      <td>{s.stage}</td>
                      <td className="font-mono text-xs text-ink-2">{s.document_ids.join(", ") || "None"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title="Decision trace" meta={`${d.audit.length} records`}>
            <AuditTable rows={[...d.audit].reverse()} showSubject={false} empty="No decisions recorded yet." />
          </Panel>
        </div>
        <div className="flex flex-col gap-4 xl:w-[376px] xl:flex-none">
          {d.approval ? (
            <Panel title="A person decides" meta={<Tag tone="warn">Waiting</Tag>}>
              <PanelBody className="flex flex-col gap-3">
                <p className="text-ink-2">{d.approval.reason}</p>
                <form action={decideEscalationAction} className="flex gap-2">
                  {hidden("approvalId", d.approval.id)}
                  {hidden("disputeId", row.id)}
                  <button name="choice" value="challenge" className="btn btn-primary">Challenge</button>
                  <button name="choice" value="accept" className="btn">Accept and refund</button>
                </form>
              </PanelBody>
            </Panel>
          ) : null}
          {order ? (
            <Panel title="Order">
              <Facts
                rows={[
                  ["Buyer", order.buyer_name],
                  ["Amount", format(order.amount_minor, order.currency)],
                  ["Channel", order.channel === "agent" ? "AI agent" : "Web"],
                  ["Carrier", order.carrier ?? "None"],
                  ["Tracking", order.tracking_number ? <span key="t" className="font-mono text-xs">{order.tracking_number}</span> : "None"],
                  ["Shipped", order.shipped_at ? date(order.shipped_at) : "Not shipped"],
                  ["Delivered", order.delivered_at ? date(order.delivered_at) : "No delivery scan"],
                ]}
              />
            </Panel>
          ) : null}
          {d.canSimulate && ["CHALLENGED", "PENDING_DECISION"].includes(row.status) ? (
            <Panel title="Sandbox: card network">
              <PanelBody className="flex flex-wrap gap-1.5">
                {row.status === "CHALLENGED" && row.stage === "RFI" ? (
                  <form action={issuerRejectsAction}>
                    {hidden("disputeId", row.id)}
                    <button className="btn btn-sm">Issuer rejects evidence</button>
                  </form>
                ) : null}
                <form action={resolveAction} className="flex gap-1.5">
                  {hidden("disputeId", row.id)}
                  <button name="winner" value="MERCHANT" className="btn btn-sm">Merchant wins</button>
                  <button name="winner" value="CUSTOMER" className="btn btn-sm">Customer wins</button>
                </form>
              </PanelBody>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
