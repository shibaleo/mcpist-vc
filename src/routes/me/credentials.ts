/**
 * /api/v1/me/credentials — per-user, per-module credential storage.
 *
 *   GET  /              List credential metadata (no secrets)
 *   PUT  /:module       Upsert credentials for `:module` (encrypted at rest)
 *   DELETE /:module     Remove credentials for `:module`
 *
 * Auth is enforced upstream in lib/hono-app.ts; we read the userId from the
 * `authResult` context variable.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, asc } from "drizzle-orm";
import type { Env } from "@/lib/hono-app";
import { db } from "@/lib/db";
import { userCredentials } from "@/lib/db/schema";
import {
  upsertModuleCredentials,
  deleteModuleCredentials,
  type Credentials,
} from "@/lib/credentials/broker";

const credentialsBody = z.object({
  // The legacy server accepted either a typed credentials envelope (auth_type
  // + tokens) or a raw connection string. Accept anything JSON-shaped here
  // and let the broker normalise.
  credentials: z.unknown(),
});

const app = new Hono<Env>()
  .get("/", async (c) => {
    const auth = c.get("authResult");
    const rows = await db
      .select({
        module: userCredentials.module,
        createdAt: userCredentials.createdAt,
        updatedAt: userCredentials.updatedAt,
      })
      .from(userCredentials)
      .where(eq(userCredentials.userId, auth.userId))
      .orderBy(asc(userCredentials.module));
    return c.json({
      data: rows.map((r) => ({
        module: r.module,
        created_at: r.createdAt.toISOString(),
        updated_at: r.updatedAt.toISOString(),
      })),
    });
  })
  .put("/:module", zValidator("json", credentialsBody), async (c) => {
    const auth = c.get("authResult");
    const module = c.req.param("module");
    const body = c.req.valid("json");

    // Accept raw string (e.g. PG connection string) → wrap as accessToken;
    // otherwise treat the supplied object as the credentials envelope.
    let creds: Credentials;
    if (typeof body.credentials === "string") {
      creds = { accessToken: body.credentials };
    } else if (
      typeof body.credentials === "object" &&
      body.credentials !== null
    ) {
      creds = body.credentials as Credentials;
    } else {
      return c.json({ error: "credentials must be string or object" }, 400);
    }

    await upsertModuleCredentials(auth.userId, module, creds);
    return c.json({ data: { success: true, module } });
  })
  .delete("/:module", async (c) => {
    const auth = c.get("authResult");
    const module = c.req.param("module");
    // Confirm a row exists so we can return 404 if not.
    const existing = await db
      .select({ module: userCredentials.module })
      .from(userCredentials)
      .where(
        and(
          eq(userCredentials.userId, auth.userId),
          eq(userCredentials.module, module),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      return c.json({ error: `no credential for module ${module}` }, 404);
    }
    await deleteModuleCredentials(auth.userId, module);
    return c.json({ data: { success: true } });
  });

export default app;
