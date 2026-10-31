import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { env } from "../env";
import { migrate } from "./migrate";

/**
 * One small interface over two drivers:
 *  - PGlite (embedded Postgres, zero setup) for local dev and tests
 *  - node-postgres for a hosted database such as Neon when DATABASE_URL is set
 * Both speak real Postgres SQL, so constraints and triggers behave the same.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const INT8_OID = 20;

export function pgliteDb(dataDir?: string): Db {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  // int8 (bigint) columns hold minor-unit amounts; parse them as JS numbers.
  const client = new PGlite(dataDir, { parsers: { [INT8_OID]: (v: string) => Number(v) } });
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await client.query<T>(sql, params)).rows;
    },
    async exec(sql) {
      await client.exec(sql);
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      return client.transaction(async (tx) =>
        fn({ query: async <R>(s: string, p: unknown[] = []) => (await tx.query<R>(s, p)).rows }),
      );
    },
    async close() {
      await client.close();
    },
  };
}

export function postgresDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    types: {
      getTypeParser: (oid: number, format?: string) =>
        oid === INT8_OID ? (v: string) => Number(v) : pg.types.getTypeParser(oid, format as "text"),
    },
  });
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await pool.query(sql, params)).rows as T[];
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      const conn = await pool.connect();
      try {
        await conn.query("BEGIN");
        const result = await fn({
          query: async <R>(s: string, p: unknown[] = []) => (await conn.query(s, p)).rows as R[],
        });
        await conn.query("COMMIT");
        return result;
      } catch (err) {
        await conn.query("ROLLBACK");
        throw err;
      } finally {
        conn.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

// Survive Next.js hot reloads in dev without opening a second database.
const globalForDb = globalThis as unknown as { trezaDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!globalForDb.trezaDb) {
    globalForDb.trezaDb = (async () => {
      const e = env();
      const db = e.DATABASE_URL ? postgresDb(e.DATABASE_URL) : pgliteDb(e.PGLITE_DIR);
      await migrate(db);
      return db;
    })();
  }
  return globalForDb.trezaDb;
}

