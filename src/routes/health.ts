import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

const app = new Hono()
  /**
   * GET /health — fast liveness probe. Does NOT touch the DB so the response
   * comes back even when DB is unreachable; useful for confirming the function
   * bundle loads at all.
   */
  .get("/", (c) =>
    c.json({
      status: "ok",
      env: {
        hasClerkPK: !!process.env.VITE_CLERK_PUBLISHABLE_KEY,
        hasClerkSK: !!process.env.CLERK_SECRET_KEY,
        hasDbUrl: !!process.env.DATABASE_URL,
        hasEncKey: !!process.env.CREDENTIAL_ENCRYPTION_KEY,
        hasJwtKey: !!process.env.SERVER_JWT_SIGNING_KEY,
      },
      runtime: {
        node: process.version,
        cwd: process.cwd(),
      },
    }),
  )
  /**
   * GET /health/diag — deep probe. Runs `SELECT 1` to validate the Neon HTTP
   * driver actually reaches the DB, and a `mcpist.users` count to confirm the
   * `mcpist` schema exists. Times out fast so a hang doesn't hold the request.
   */
  .get("/diag", async (c) => {
    const phases: Array<{ name: string; ms: number; ok: boolean; error?: string; extra?: unknown }> = [];

    const probe = async <T>(name: string, fn: () => Promise<T>) => {
      const t0 = Date.now();
      try {
        const r = await Promise.race([
          fn(),
          new Promise<T>((_, rej) =>
            setTimeout(() => rej(new Error("timeout 20s")), 20_000),
          ),
        ]);
        phases.push({ name, ms: Date.now() - t0, ok: true, extra: r });
      } catch (e) {
        // Surface as much detail as possible — neon-http wraps Postgres
        // errors and the inner cause carries the SQLSTATE / message.
        const detail =
          e instanceof Error
            ? `${e.message}${e.cause instanceof Error ? ` | cause: ${e.cause.message}` : ""}`
            : String(e);
        phases.push({
          name,
          ms: Date.now() - t0,
          ok: false,
          error: detail,
        });
      }
    };

    /**
     * drizzle-orm/neon-http's `db.execute()` returns an array-like result
     * whose `.rows` carries the row data. We coerce via `Array.from`
     * to handle either shape (recent drizzle versions return the bare array).
     */
    const exec = async <R extends Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<R[]> => {
      const r = (await db.execute(q)) as { rows?: R[] } | R[];
      return Array.isArray(r) ? r : Array.from(r.rows ?? []);
    };

    await probe("db-select-1", async () => {
      const rows = await exec<{ one: number }>(sql`SELECT 1 AS one`);
      return { rows: rows.length };
    });

    await probe("db-mcpist-schema-exists", async () => {
      const rows = await exec<{ exists: number }>(
        sql`SELECT 1 AS exists FROM information_schema.schemata WHERE schema_name = 'mcpist'`,
      );
      return { exists: rows.length > 0 };
    });

    await probe("db-users-count", async () => {
      const rows = await exec<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM mcpist.users`,
      );
      return { count: rows[0]?.count ?? 0 };
    });

    return c.json({
      status: phases.every((p) => p.ok) ? "ok" : "degraded",
      phases,
    });
  });

export default app;
