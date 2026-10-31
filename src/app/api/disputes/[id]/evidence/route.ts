import { getApp } from "@/lib/app";
import type { DisputeDecision } from "@/lib/disputes/agent";
import { buildEvidencePdf } from "@/lib/disputes/packet";
import { getOrder, orderSummary } from "@/lib/disputes/records";
import { format } from "@/lib/money/money";

/** Rebuilds the evidence package from the stored, verified decision for review. */
export async function GET(_req: Request, ctx: RouteContext<"/api/disputes/[id]/evidence">) {
  const { id } = await ctx.params;
  const { db } = await getApp();
  const [d] = await db.query<{ airwallex_dispute_id: string; order_id: string; reason_code: string; amount_minor: number; currency: string; decision: DisputeDecision }>(
    "SELECT * FROM disputes WHERE id = $1",
    [id],
  );
  if (!d?.decision?.facts) return new Response("Not found", { status: 404 });
  const order = await getOrder(db, d.order_id);
  if (!order) return new Response("Not found", { status: 404 });
  const docs = await db.query<{ id: string; title: string; body: string }>(
    "SELECT id, title, body FROM order_documents WHERE order_id = $1 AND available_at <= now()",
    [order.id],
  );
  const cited = new Set(d.decision.facts.map((f) => f.source));
  const pdf = await buildEvidencePdf({
    merchant: "Meridian Market",
    disputeId: d.airwallex_dispute_id,
    reasonCode: d.reason_code,
    reasonLabel: d.decision.assessment.reasonLabel,
    amount: format(d.amount_minor, d.currency),
    orderId: order.id,
    orderSummary: orderSummary(order),
    facts: d.decision.facts,
    documents: docs.filter((doc) => cited.has(doc.id)),
  });
  return new Response(pdf as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="evidence-${order.id}.pdf"` } });
}
