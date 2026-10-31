import { z } from "zod";
import { verifyAirwallexSignature } from "./airwallex/webhook";
import type { Queryable } from "./db/client";
import { recordInbound } from "./events/bus";
import { tenantForAirwallexAccount } from "./tenancy";

const Envelope = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  account_id: z.string().optional(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }).passthrough(),
  created_at: z.string().optional(),
});

export type IntakeResult =
  | { status: 200; eventId: string; duplicate: boolean }
  | { status: 400 | 401 | 503; error: string };

/**
 * Verifies, validates and records one Airwallex webhook delivery.
 * Processing happens afterwards so Airwallex gets a fast 200.
 */
export async function intakeAirwallexWebhook(
  q: Queryable,
  req: { rawBody: string; timestamp: string | null; signature: string | null },
  secret: string | undefined,
  now?: number,
): Promise<IntakeResult> {
  if (!secret) return { status: 503, error: "webhook secret not configured" };
  const verified = verifyAirwallexSignature({ ...req, secret, now });
  if (!verified.ok) return { status: 401, error: verified.reason };

  let json: unknown;
  try {
    json = JSON.parse(req.rawBody);
  } catch {
    return { status: 400, error: "body is not valid JSON" };
  }
  const parsed = Envelope.safeParse(json);
  if (!parsed.success) return { status: 400, error: "not an Airwallex webhook envelope" };

  const event = parsed.data;
  const tenantId = await tenantForAirwallexAccount(q, event.account_id);
  const { eventId, duplicate } = await recordInbound(q, {
    externalId: event.id,
    type: event.name,
    tenantId,
    payload: event,
    occurredAt: event.created_at,
  });
  return { status: 200, eventId, duplicate };
}
