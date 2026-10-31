import type { Db, Queryable } from "../db/client";

export interface EventRow {
  id: string;
  source: "airwallex" | "treza";
  external_id: string;
  type: string;
  tenant_id: string | null;
  payload: Record<string, unknown>;
  status: "received" | "processed" | "failed" | "ignored";
  attempts: number;
  error: string | null;
  occurred_at: string;
  received_at: string;
  processed_at: string | null;
}

export type Handler = (event: EventRow, db: Db) => Promise<void>;

/**
 * The shared event ledger. Airwallex webhooks and Treza's own domain events
 * land in one table, and the closed loop is built from handlers on it.
 */
export class EventBus {
  private handlers = new Map<string, Handler[]>();

  on(type: string, handler: Handler): this {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
    return this;
  }

  handles(type: string): boolean {
    return (this.handlers.get(type)?.length ?? 0) > 0;
  }

  /**
   * Processes received events oldest first. Webhooks arrive unordered, so
   * ordering uses the time the event happened, not when it arrived.
   */
  async processPending(db: Db, maxAttempts = 5): Promise<{ processed: number; failed: number }> {
    let processed = 0;
    let failed = 0;
    const pending = await db.query<EventRow>(
      `SELECT * FROM events WHERE status IN ('received', 'failed') AND attempts < $1
       ORDER BY occurred_at, received_at LIMIT 100`,
      [maxAttempts],
    );
    for (const event of pending) {
      const handlers = this.handlers.get(event.type) ?? [];
      if (handlers.length === 0) {
        await db.query("UPDATE events SET status = 'ignored', processed_at = now() WHERE id = $1", [event.id]);
        continue;
      }
      try {
        for (const h of handlers) await h(event, db);
        await db.query(
          "UPDATE events SET status = 'processed', attempts = attempts + 1, error = NULL, processed_at = now() WHERE id = $1",
          [event.id],
        );
        processed++;
      } catch (err) {
        await db.query("UPDATE events SET status = 'failed', attempts = attempts + 1, error = $2 WHERE id = $1", [
          event.id,
          err instanceof Error ? err.message : String(err),
        ]);
        failed++;
      }
    }
    return { processed, failed };
  }
}

/** Records an inbound webhook. A redelivered event id is recognised and dropped. */
export async function recordInbound(
  q: Queryable,
  e: { externalId: string; type: string; tenantId?: string | null; payload: unknown; occurredAt?: string },
): Promise<{ eventId: string; duplicate: boolean }> {
  return insertEvent(q, "airwallex", e);
}

/** Emits an internal Treza event. The key makes emission idempotent too. */
export async function emit(
  q: Queryable,
  e: { key: string; type: string; tenantId?: string | null; payload: unknown },
): Promise<{ eventId: string; duplicate: boolean }> {
  return insertEvent(q, "treza", { externalId: e.key, type: e.type, tenantId: e.tenantId, payload: e.payload });
}

async function insertEvent(
  q: Queryable,
  source: "airwallex" | "treza",
  e: { externalId: string; type: string; tenantId?: string | null; payload: unknown; occurredAt?: string },
): Promise<{ eventId: string; duplicate: boolean }> {
  const rows = await q.query<{ id: string }>(
    `INSERT INTO events (source, external_id, type, tenant_id, payload, occurred_at)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()))
     ON CONFLICT (source, external_id) DO NOTHING RETURNING id`,
    [source, e.externalId, e.type, e.tenantId ?? null, JSON.stringify(e.payload ?? {}), e.occurredAt ?? null],
  );
  if (rows.length > 0) return { eventId: rows[0].id, duplicate: false };
  const existing = await q.query<{ id: string }>("SELECT id FROM events WHERE source = $1 AND external_id = $2", [
    source,
    e.externalId,
  ]);
  return { eventId: existing[0].id, duplicate: true };
}

export async function listEvents(
  q: Queryable,
  filter: { tenantId?: string; limit?: number } = {},
): Promise<EventRow[]> {
  const limit = Math.min(filter.limit ?? 50, 500);
  return filter.tenantId
    ? q.query<EventRow>(`SELECT * FROM events WHERE tenant_id = $1 ORDER BY occurred_at DESC LIMIT ${limit}`, [
        filter.tenantId,
      ])
    : q.query<EventRow>(`SELECT * FROM events ORDER BY occurred_at DESC LIMIT ${limit}`);
}
