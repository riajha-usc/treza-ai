import type { Queryable } from "../db/client";
import { isAirwallexError } from "./client";

export interface OutboundRow {
  op_key: string;
  request_id: string;
  status: "pending" | "succeeded" | "failed" | "unknown";
  response: unknown;
  error: string | null;
}

/**
 * Runs a money-moving call so that one logical operation (opKey) can only
 * ever use one Airwallex request_id. The id is stored before the call, so a
 * crash or timeout followed by a retry sends the same id, and Airwallex
 * treats it as the same request instead of a second payment.
 */
export async function onceForOperation<T>(
  q: Queryable,
  op: { key: string; tenantId?: string | null; method: string; path: string },
  call: (requestId: string) => Promise<T>,
): Promise<{ result: T; requestId: string; replayed: boolean }> {
  await q.query(
    `INSERT INTO outbound_requests (op_key, tenant_id, method, path) VALUES ($1, $2, $3, $4)
     ON CONFLICT (op_key) DO NOTHING`,
    [op.key, op.tenantId ?? null, op.method, op.path],
  );
  const [row] = await q.query<OutboundRow>("SELECT * FROM outbound_requests WHERE op_key = $1", [op.key]);
  if (row.status === "succeeded") {
    return { result: row.response as T, requestId: row.request_id, replayed: true };
  }
  if (row.status === "failed") {
    throw new Error(`Operation ${op.key} already failed permanently: ${row.error}`);
  }
  try {
    const result = await call(row.request_id);
    await q.query(
      "UPDATE outbound_requests SET status = 'succeeded', response = $2, error = NULL, updated_at = now() WHERE op_key = $1",
      [op.key, JSON.stringify(result ?? null)],
    );
    return { result, requestId: row.request_id, replayed: false };
  } catch (err) {
    // A retryable failure leaves the outcome unknown: the request may have
    // landed. It stays retryable with the same request_id, never a new one.
    // 401 and 403 mean the request was refused before it ran, so a retry
    // after fixing credentials or permissions is safe too.
    const definitive = isAirwallexError(err) && !err.retryable && err.status !== 401 && err.status !== 403;
    await q.query("UPDATE outbound_requests SET status = $2, error = $3, updated_at = now() WHERE op_key = $1", [
      op.key,
      definitive ? "failed" : "unknown",
      err instanceof Error ? err.message : String(err),
    ]);
    throw err;
  }
}
