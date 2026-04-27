/**
 * DB client for the mcpist Postgres schema (Vercel Functions, Node runtime).
 *
 * Uses the @neondatabase/serverless HTTP driver: no persistent TCP socket,
 * so cold-start cost is just the import — no connect handshake. Required by
 * Neon's pooler-less HTTP endpoint.
 *
 * The HTTP `sql` callable is constructed lazily because `neon()` throws
 * synchronously when DATABASE_URL is unset, and we want module load to
 * succeed even in environments without DB credentials (so `/api/v1/health`
 * still responds and the failure is visible from there).
 *
 * For arbitrary user PostgreSQL connections (PG module), see
 * lib/mcp/modules/postgresql/tools.ts which uses postgres-js (TCP).
 */
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type Schema = typeof schema;

const globalForDb = globalThis as unknown as {
  _neonSql?: NeonQueryFunction<false, false>;
  _neonDrizzle?: NeonHttpDatabase<Schema>;
};

console.log("[boot] db: module load", {
  hasDbUrl: !!process.env.DATABASE_URL,
  cached: !!globalForDb._neonDrizzle,
});

function getDb(): NeonHttpDatabase<Schema> {
  if (globalForDb._neonDrizzle) return globalForDb._neonDrizzle;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  const client = neon(url);
  const d = drizzle(client, { schema });
  globalForDb._neonSql = client;
  globalForDb._neonDrizzle = d;
  return d;
}

/**
 * Proxy that defers DB initialisation until the first call. The cast routes
 * every property/method access through `getDb()` so we don't need a
 * top-level `await` (drizzle is sync to construct, just throws on unset URL).
 */
export const db = new Proxy({} as NeonHttpDatabase<Schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});
