/**
 * One-off read-only probe: dump non-secret metadata for `mcpist.oauth_apps`.
 * Useful to confirm whether the legacy admin UI registrations are visible
 * to mcpist-vc through the shared Neon DB.
 */

import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url, {
  ssl: "require",
  prepare: false,
  max: 1,
  connect_timeout: 30,
});

try {
  const rows = await sql`
    SELECT
      provider,
      client_id,
      (encrypted_client_secret IS NOT NULL) AS has_secret,
      enabled,
      redirect_uri,
      created_at,
      updated_at
    FROM mcpist.oauth_apps
    ORDER BY provider
  `;
  if (rows.length === 0) {
    console.log("(no rows in mcpist.oauth_apps)");
  } else {
    console.table(
      rows.map((r) => ({
        provider: r.provider,
        client_id_prefix: (r.client_id || "").slice(0, 12) + "…",
        has_secret: r.has_secret,
        enabled: r.enabled,
        redirect_uri: r.redirect_uri,
        updated_at: r.updated_at?.toISOString?.() ?? r.updated_at,
      })),
    );
  }
} catch (e) {
  console.error("query failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
