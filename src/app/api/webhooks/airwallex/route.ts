import { after } from "next/server";
import { getApp } from "@/lib/app";
import { env } from "@/lib/env";
import { intakeAirwallexWebhook } from "@/lib/intake";

export async function POST(request: Request) {
  const { db, bus } = await getApp();
  // Read raw text: the signature covers the exact bytes Airwallex sent.
  const rawBody = await request.text();
  const result = await intakeAirwallexWebhook(
    db,
    {
      rawBody,
      timestamp: request.headers.get("x-timestamp"),
      signature: request.headers.get("x-signature"),
    },
    env().AIRWALLEX_WEBHOOK_SECRET,
  );
  if (result.status !== 200) return Response.json({ error: result.error }, { status: result.status });

  after(() => bus.processPending(db));
  return Response.json({ received: true, duplicate: result.duplicate });
}
