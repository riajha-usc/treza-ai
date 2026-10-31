import type { Db } from "./client";
import { MIGRATIONS } from "./migrations";

/** Applies each migration once, in order, recording it in schema_migrations. */
export async function migrate(db: Db): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const applied = new Set(
    (await db.query<{ id: string }>("SELECT id FROM schema_migrations")).map((r) => r.id),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    await db.exec(`BEGIN; ${m.sql}; INSERT INTO schema_migrations (id) VALUES ('${m.id}'); COMMIT;`);
  }
}
