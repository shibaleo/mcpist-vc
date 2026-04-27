/**
 * PostgreSQL module tool handlers.
 *
 * Ported 1:1 from the legacy Go implementation
 * (apps/server/internal/modules/postgresql/module.go). Behaviour, error
 * messages, and result shape match Go because existing MCP clients are
 * coded against the old wire format.
 *
 * Connection model: each invocation opens a new TCP connection via
 * postgres-js, runs queries with `connectTimeout: 10s` / `queryTimeout: 30s`,
 * and disposes (`client.end()`) before returning. We do NOT pool — user PG
 * databases are arbitrary endpoints, so a Vercel-warm-instance pool would
 * leak connections across users. The Vercel cold-start cost dominates here
 * anyway.
 */

import postgres, { type PostgresType, type Sql } from "postgres";
import { getModuleCredentials } from "@/lib/credentials/broker";
import type { ModuleContext } from "@/lib/mcp/types";

const CONNECT_TIMEOUT_S = 10;
const QUERY_TIMEOUT_S = 30;
const DEFAULT_MAX_ROWS = 1000;
const MAX_MAX_ROWS = 10000;

// ── SQL safety regexes (mirror Go) ────────────────────────────────────────

const dangerousPatterns: RegExp[] = [
  /^\s*DROP\s+/i,
  /^\s*TRUNCATE\s+/i,
  /^\s*ALTER\s+/i,
  /^\s*CREATE\s+/i,
  /^\s*GRANT\s+/i,
  /^\s*REVOKE\s+/i,
  /;\s*DROP\s+/i,
  /;\s*TRUNCATE\s+/i,
  /;\s*ALTER\s+/i,
  /;\s*CREATE\s+/i,
];

const writePatterns: RegExp[] = [
  /^\s*INSERT\s+/i,
  /^\s*UPDATE\s+/i,
  /^\s*DELETE\s+/i,
];

function isDDL(sql: string): boolean {
  return dangerousPatterns.some((re) => re.test(sql));
}

function isWriteOperation(sql: string): boolean {
  return writePatterns.some((re) => re.test(sql));
}

function isSelectOnly(sql: string): boolean {
  const trimmed = sql.trimStart().toUpperCase();
  return trimmed.startsWith("SELECT") || trimmed.startsWith("WITH");
}

// ── Connection management ─────────────────────────────────────────────────

interface ParsedConn {
  raw: string;
  url: URL;
}

async function getConnectionInfo(ctx: ModuleContext): Promise<ParsedConn> {
  const creds = await getModuleCredentials(ctx.userId, "postgresql");
  if (!creds || !creds.accessToken) {
    throw new Error("PostgreSQL connection string not configured");
  }
  return parseAndValidate(creds.accessToken);
}

function parseAndValidate(connStr: string): ParsedConn {
  let url: URL;
  try {
    url = new URL(connStr);
  } catch {
    throw new Error("invalid connection string format");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("scheme must be postgresql or postgres");
  }
  if (!url.hostname) throw new Error("host is required");

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    throw new Error("localhost connections are not allowed for security reasons");
  }

  const dbName = url.pathname.replace(/^\//, "");
  if (!dbName) throw new Error("database name is required");

  // Append sslmode=require if not present (Go did the same).
  let raw = connStr;
  if (!/[?&]sslmode=/i.test(raw)) {
    raw += raw.includes("?") ? "&sslmode=require" : "?sslmode=require";
  }

  return { raw, url };
}

/**
 * Open a postgres-js client. Caller MUST `await client.end()` when done.
 *
 * postgres-js uses a different timeout knob than pgx: `connect_timeout`
 * (seconds) for the TCP+startup phase, and `idle_timeout` for keep-alive.
 * Per-statement timeout is enforced by Promise.race in each handler — see
 * `runWithTimeout`.
 */
function open(connStr: string): Sql {
  return postgres(connStr, {
    max: 1,
    connect_timeout: CONNECT_TIMEOUT_S,
    idle_timeout: 5,
    prepare: false,
    types: {
      // Cast bigint → string so JSON serialisation doesn't lose precision.
      bigint: {
        to: 20,
        from: [20],
        serialize: (v: bigint | number | string) => String(v),
        parse: (v: string) => v,
      } as PostgresType<bigint | number | string>,
    },
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function withConnection<T>(
  ctx: ModuleContext,
  fn: (sql: Sql, info: ParsedConn) => Promise<T>,
): Promise<T> {
  const info = await getConnectionInfo(ctx);
  const sql = open(info.raw);
  try {
    return await fn(sql, info);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch (e) {
      console.error("[pg] sql.end failed:", e);
    }
  }
}

// ── Tool implementations ──────────────────────────────────────────────────

export async function testConnection(ctx: ModuleContext): Promise<string> {
  return withConnection(ctx, async (sql, info) => {
    const rows = await withTimeout(
      sql<{ version: string }[]>`SELECT version() AS version`,
      QUERY_TIMEOUT_S * 1000,
      "test_connection",
    );
    const version = rows[0]?.version ?? "";

    const result: Record<string, unknown> = {
      success: true,
      version,
      host: info.url.hostname,
      port: info.url.port || "",
      database: info.url.pathname.replace(/^\//, ""),
    };
    if (info.url.username) {
      result.user = decodeURIComponent(info.url.username);
    }
    return JSON.stringify(result);
  });
}

export async function listSchemas(
  ctx: ModuleContext,
  params: Record<string, unknown>,
): Promise<string> {
  const includeSystem = params.include_system === true;
  return withConnection(ctx, async (sql) => {
    const rows = includeSystem
      ? await withTimeout(
          sql<{ schema_name: string }[]>`
            SELECT schema_name
            FROM information_schema.schemata
            ORDER BY schema_name
          `,
          QUERY_TIMEOUT_S * 1000,
          "list_schemas",
        )
      : await withTimeout(
          sql<{ schema_name: string }[]>`
            SELECT schema_name
            FROM information_schema.schemata
            WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
            ORDER BY schema_name
          `,
          QUERY_TIMEOUT_S * 1000,
          "list_schemas",
        );
    return JSON.stringify({ schemas: rows.map((r) => r.schema_name) });
  });
}

export async function listTables(
  ctx: ModuleContext,
  params: Record<string, unknown>,
): Promise<string> {
  const schema =
    typeof params.schema === "string" && params.schema !== ""
      ? params.schema
      : "public";
  const includeViews = params.include_views !== false;
  const tableTypes = includeViews
    ? ["BASE TABLE", "VIEW"]
    : ["BASE TABLE"];

  return withConnection(ctx, async (sql) => {
    const rows = await withTimeout(
      sql<{ table_name: string; table_type: string; row_estimate: string }[]>`
        SELECT
          t.table_name,
          t.table_type,
          COALESCE(s.n_live_tup, 0)::text AS row_estimate
        FROM information_schema.tables t
        LEFT JOIN pg_stat_user_tables s
          ON t.table_name = s.relname
          AND t.table_schema = s.schemaname
        WHERE t.table_schema = ${schema}
          AND t.table_type IN ${sql(tableTypes)}
        ORDER BY t.table_name
      `,
      QUERY_TIMEOUT_S * 1000,
      "list_tables",
    );
    const tables = rows.map((r) => ({
      name: r.table_name,
      type: r.table_type === "BASE TABLE" ? "table" : "view",
      rows_estimate: Number.parseInt(r.row_estimate, 10),
    }));
    return JSON.stringify({ schema, tables });
  });
}

export async function describeTable(
  ctx: ModuleContext,
  params: Record<string, unknown>,
): Promise<string> {
  const table = params.table;
  if (typeof table !== "string" || table === "") {
    throw new Error("table is required");
  }
  const schema =
    typeof params.schema === "string" && params.schema !== ""
      ? params.schema
      : "public";

  return withConnection(ctx, async (sql) => {
    const columns = await withTimeout(
      sql<
        {
          column_name: string;
          data_type: string;
          nullable: boolean;
          column_default: string | null;
          is_primary_key: boolean;
        }[]
      >`
        SELECT
          c.column_name,
          c.data_type,
          c.is_nullable = 'YES' AS nullable,
          c.column_default,
          EXISTS (
            SELECT 1 FROM information_schema.key_column_usage k
            JOIN information_schema.table_constraints tc
              ON k.constraint_name = tc.constraint_name
              AND k.table_schema = tc.table_schema
            WHERE k.table_schema = c.table_schema
              AND k.table_name = c.table_name
              AND k.column_name = c.column_name
              AND tc.constraint_type = 'PRIMARY KEY'
          ) AS is_primary_key
        FROM information_schema.columns c
        WHERE c.table_schema = ${schema} AND c.table_name = ${table}
        ORDER BY c.ordinal_position
      `,
      QUERY_TIMEOUT_S * 1000,
      "describe_table.columns",
    );

    if (columns.length === 0) {
      throw new Error(`table ${schema}.${table} not found`);
    }

    const indexes = await withTimeout(
      sql<{ indexname: string; indexdef: string }[]>`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = ${schema} AND tablename = ${table}
      `,
      QUERY_TIMEOUT_S * 1000,
      "describe_table.indexes",
    );

    const rowCountRow = await withTimeout(
      sql<{ row_count: string }[]>`
        SELECT COALESCE(n_live_tup, 0)::text AS row_count
        FROM pg_stat_user_tables
        WHERE schemaname = ${schema} AND relname = ${table}
      `,
      QUERY_TIMEOUT_S * 1000,
      "describe_table.row_count",
    );
    const rowCount =
      rowCountRow.length > 0 ? Number.parseInt(rowCountRow[0].row_count, 10) : 0;

    return JSON.stringify({
      table,
      schema,
      columns: columns.map((c) => ({
        name: c.column_name,
        type: c.data_type,
        nullable: c.nullable,
        default: c.column_default,
        primary_key: c.is_primary_key,
      })),
      indexes: indexes.map((i) => ({
        name: i.indexname,
        definition: i.indexdef,
      })),
      row_count_estimate: rowCount,
    });
  });
}

export async function queryTool(
  ctx: ModuleContext,
  params: Record<string, unknown>,
): Promise<string> {
  const sqlText = params.sql;
  if (typeof sqlText !== "string" || sqlText === "") {
    throw new Error("sql is required");
  }
  if (!isSelectOnly(sqlText)) {
    throw new Error(
      "only SELECT queries are allowed. Use 'execute' for INSERT/UPDATE/DELETE or 'execute_ddl' for DDL",
    );
  }
  if (isDDL(sqlText)) {
    throw new Error("DDL statements are not allowed in query tool");
  }

  const queryParams = Array.isArray(params.params)
    ? (params.params as unknown[])
    : [];

  let maxRows = DEFAULT_MAX_ROWS;
  if (typeof params.max_rows === "number" && Number.isFinite(params.max_rows)) {
    maxRows = Math.floor(params.max_rows);
    if (maxRows > MAX_MAX_ROWS) maxRows = MAX_MAX_ROWS;
    if (maxRows < 1) maxRows = 1;
  }

  return withConnection(ctx, async (sql) => {
    // postgres-js: tagged-template is for static SQL. For arbitrary SQL with
    // $1/$2 placeholders we use sql.unsafe(query, params), which is the
    // intended escape hatch for user-supplied SELECT.
    const rows = await withTimeout(
      sql.unsafe(sqlText, queryParams as never[]),
      QUERY_TIMEOUT_S * 1000,
      "query",
    );

    const truncated = rows.length > maxRows;
    const slice = truncated ? rows.slice(0, maxRows) : rows;

    // Column names: postgres-js exposes `rows.columns` as an array of
    // descriptors. Fall back to keys of the first row if the metadata is
    // missing (e.g. zero-row result with no row template).
    let columns: string[];
    const meta = (rows as unknown as { columns?: { name: string }[] }).columns;
    if (meta && meta.length > 0) {
      columns = meta.map((c) => c.name);
    } else if (slice.length > 0) {
      columns = Object.keys(slice[0] as Record<string, unknown>);
    } else {
      columns = [];
    }

    const resultRows = slice.map((r) =>
      columns.map((c) => convertValue((r as Record<string, unknown>)[c])),
    );

    return JSON.stringify({
      columns,
      rows: resultRows,
      row_count: resultRows.length,
      truncated,
    });
  });
}

export async function executeTool(
  ctx: ModuleContext,
  params: Record<string, unknown>,
): Promise<string> {
  const sqlText = params.sql;
  if (typeof sqlText !== "string" || sqlText === "") {
    throw new Error("sql is required");
  }
  if (!isWriteOperation(sqlText)) {
    throw new Error(
      "only INSERT/UPDATE/DELETE statements are allowed. Use 'query' for SELECT or 'execute_ddl' for DDL",
    );
  }
  if (isDDL(sqlText)) {
    throw new Error("DDL statements are not allowed in execute tool");
  }

  const queryParams = Array.isArray(params.params)
    ? (params.params as unknown[])
    : [];

  return withConnection(ctx, async (sql) => {
    const result = await withTimeout(
      sql.unsafe(sqlText, queryParams as never[]),
      QUERY_TIMEOUT_S * 1000,
      "execute",
    );
    // postgres-js attaches metadata: count (rows affected) and command.
    const meta = result as unknown as { count?: number; command?: string };
    return JSON.stringify({
      rows_affected: meta.count ?? 0,
      command: meta.command ?? "",
    });
  });
}

export async function executeDDL(
  ctx: ModuleContext,
  params: Record<string, unknown>,
): Promise<string> {
  const sqlText = params.sql;
  if (typeof sqlText !== "string" || sqlText === "") {
    throw new Error("sql is required");
  }
  if (!isDDL(sqlText)) {
    throw new Error(
      "only DDL statements (CREATE/ALTER/DROP/TRUNCATE) are allowed. Use 'query' for SELECT or 'execute' for INSERT/UPDATE/DELETE",
    );
  }
  return withConnection(ctx, async (sql) => {
    const result = await withTimeout(
      sql.unsafe(sqlText),
      QUERY_TIMEOUT_S * 1000,
      "execute_ddl",
    );
    const meta = result as unknown as { command?: string };
    return JSON.stringify({
      success: true,
      command: meta.command ?? "",
    });
  });
}

// ── Value coercion ────────────────────────────────────────────────────────

/**
 * postgres-js already does decent type coercion (numeric → string for big
 * numbers, Date for timestamps, Buffer for bytea). We just need to guarantee
 * JSON-serialisable output: turn Buffer into base64, Date into ISO string,
 * BigInt into string. UUIDs come back as strings already.
 */
function convertValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) {
    let bin = "";
    for (let i = 0; i < v.length; i++) bin += String.fromCharCode(v[i]);
    return btoa(bin);
  }
  return v;
}
