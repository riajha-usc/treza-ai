import { createHmac, timingSafeEqual } from "node:crypto";

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Airwallex signs HMAC-SHA256 over x-timestamp followed directly by the raw
 * body, hex encoded, keyed with the webhook secret. x-timestamp is in
 * milliseconds. Verify the raw bytes before parsing any JSON.
 */
export function verifyAirwallexSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  toleranceMs?: number;
  now?: number;
}): VerifyResult {
  const { rawBody, timestamp, signature, secret } = input;
  if (!timestamp || !signature) return { ok: false, reason: "missing signature headers" };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "invalid timestamp" };
  const tolerance = input.toleranceMs ?? 5 * 60_000;
  if (Math.abs((input.now ?? Date.now()) - ts) > tolerance) return { ok: false, reason: "timestamp outside tolerance" };

  const expected = createHmac("sha256", secret).update(timestamp + rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim().toLowerCase(), "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "signature mismatch" };
  return { ok: true };
}

export function signForTests(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(timestamp + rawBody).digest("hex");
}

/** Webhook envelope from the Airwallex docs. */
export interface AirwallexWebhook {
  id: string;
  name: string;
  account_id?: string;
  org_id?: string;
  data: { object: Record<string, unknown> };
  created_at: string;
  version?: string;
}
