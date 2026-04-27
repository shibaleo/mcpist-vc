import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, {
  ssl: "require",
  prepare: false,
  max: 1,
  connect_timeout: 30,
});

try {
  // Look at every row count in the mcpist schema so we know what existing
  // data is reachable via this DATABASE_URL.
  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'mcpist'
    ORDER BY table_name
  `;
  const result = [];
  for (const { table_name } of tables) {
    const c = await sql.unsafe(
      `SELECT COUNT(*)::int AS n FROM mcpist.${table_name}`,
    );
    result.push({ table: table_name, rows: c[0].n });
  }
  console.table(result);
} finally {
  await sql.end({ timeout: 5 });
}
