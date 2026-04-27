/**
 * One-shot bootstrap: apply the baseline SQL migration to the configured DB.
 *
 * Usage: pnpm db:bootstrap
 *
 * Idempotent — every CREATE statement uses IF NOT EXISTS or ON CONFLICT,
 * so re-running this on a populated DB is a no-op. We use postgres-js
 * (not the Neon HTTP driver) here because the baseline contains
 * multi-statement DDL with PL/pgSQL-style functions that Neon's HTTP
 * single-shot endpoint can't run as one transaction.
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sqlText = readFileSync("database/migrations/00000000000001_baseline.sql", "utf-8");

const sql = postgres(url, {
  ssl: "require",
  prepare: false,
  max: 1,
  connect_timeout: 30,
});

console.log("→ applying baseline migration to", url.replace(/\/\/[^@]+@/, "//***@"));
const t0 = Date.now();
try {
  // postgres-js's `unsafe()` accepts multi-statement strings and runs them
  // as a single simple-query, which matches how the baseline was authored.
  await sql.unsafe(sqlText);
  console.log(`✓ done in ${Date.now() - t0}ms`);
} catch (e) {
  console.error("✗ migration failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
