import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/**
 * Database access.
 *
 * - If DATABASE_URL is set, use a real Postgres server (e.g. Neon) via postgres.js.
 * - Otherwise fall back to PGlite: an embedded, file-backed Postgres that needs no
 *   server or credentials. Great for local dev — data lives in ./data/pglite.
 *
 * Both paths return a Drizzle client over the same schema, so query code is identical.
 */

// Both drivers expose a structurally-compatible query builder over our schema;
// pin the exported type to one so callers get consistent typings.
export type Db = PostgresJsDatabase<typeof schema>;

let _dbPromise: Promise<Db> | undefined;

async function createDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;

  if (url) {
    const [{ drizzle }, postgres] = await Promise.all([
      import("drizzle-orm/postgres-js"),
      import("postgres").then((m) => m.default),
    ]);
    const client = postgres(url, { prepare: false });
    return drizzle(client, { schema });
  }

  // Embedded PGlite fallback.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dataDir = process.env.PGLITE_DIR ?? join(process.cwd(), "data", "pglite");
  const client = new PGlite(dataDir);
  await client.waitReady;
  await ensureSchema(client);
  return drizzle(client, { schema }) as unknown as Db;
}

async function ensureSchema(client: {
  exec: (sql: string) => Promise<unknown>;
}) {
  // Create tables/indexes if absent (idempotent) from the generated migration.
  const initSql = await readFile(
    join(process.cwd(), "drizzle", "0000_init.sql"),
    "utf8",
  );
  const cleaned = initSql
    .replace(/--> statement-breakpoint/g, "")
    // CREATE TABLE / INDEX -> IF NOT EXISTS so re-runs are safe.
    .replace(/CREATE TABLE /g, "CREATE TABLE IF NOT EXISTS ")
    .replace(/CREATE INDEX /g, "CREATE INDEX IF NOT EXISTS ")
    .replace(/CREATE UNIQUE INDEX /g, "CREATE UNIQUE INDEX IF NOT EXISTS ");

  for (const stmt of cleaned.split(";")) {
    const s = stmt.trim();
    if (!s) continue;
    try {
      await client.exec(s + ";");
    } catch (err) {
      // The FK ALTER isn't idempotent; ignore "already exists" style errors.
      if (!/already exists|duplicate/i.test((err as Error).message)) {
        // eslint-disable-next-line no-console
        console.warn("schema stmt failed:", (err as Error).message);
      }
    }
  }
}

/** Get the shared Drizzle client (memoized). */
export function getDb(): Promise<Db> {
  _dbPromise ??= createDb();
  return _dbPromise;
}

export { schema };
