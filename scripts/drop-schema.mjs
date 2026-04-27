/**
 * Destructive: drop the entire `mcpist` schema from whatever DATABASE_URL
 * resolves to right now. Used when starting fresh or switching DBs.
 *
 * Run explicitly — `node scripts/drop-schema.mjs`. Refuses to run unless
 * MCPIST_CONFIRM_DROP=1 is set, so it never deletes data by accident.
 */

import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const safeHost = url.replace(/\/\/[^@]+@/, "//***@");

if (process.env.MCPIST_CONFIRM_DROP !== "1") {
  console.log("→ would drop `mcpist` schema from", safeHost);
  console.log("  set MCPIST_CONFIRM_DROP=1 to actually drop");
  process.exit(0);
}

const sql = postgres(url, {
  ssl: "require",
  prepare: false,
  max: 1,
  connect_timeout: 30,
});

console.log("→ dropping `mcpist` schema from", safeHost);
try {
  await sql.unsafe("DROP SCHEMA IF EXISTS mcpist CASCADE");
  console.log("✓ done");
} catch (e) {
  console.error("✗ failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
