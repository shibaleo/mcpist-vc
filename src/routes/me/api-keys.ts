/**
 * /api/v1/me/api-keys — issue / list / revoke MCP-client API keys.
 *
 *   GET  /        List the user's keys (metadata only — no token recovery)
 *   POST /        Issue a new key. Token is returned ONCE in this response.
 *   DELETE /:id   Revoke a key by row id (the kid lookup will then fail).
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import type { Env } from "@/lib/hono-app";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";
import { issueApiKey } from "@/lib/api-key";

const DEFAULT_TTL_DAYS = 90;

const createBody = z.object({
  display_name: z.string().min(1).max(100),
  expires_at: z.string().datetime().optional(),
  no_expiry: z.boolean().optional(),
});

const app = new Hono<Env>()
  .get("/", async (c) => {
    const auth = c.get("authResult");
    const rows = await db
      .select({
        id: apiKeys.id,
        keyPrefix: apiKeys.keyPrefix,
        name: apiKeys.name,
        expiresAt: apiKeys.expiresAt,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, auth.userId))
      .orderBy(desc(apiKeys.createdAt));
    return c.json({
      data: rows.map((r) => ({
        id: r.id,
        key_prefix: r.keyPrefix,
        display_name: r.name,
        expires_at: r.expiresAt?.toISOString() ?? null,
        last_used_at: r.lastUsedAt?.toISOString() ?? null,
        created_at: r.createdAt.toISOString(),
      })),
    });
  })
  .post("/", zValidator("json", createBody), async (c) => {
    const auth = c.get("authResult");
    const body = c.req.valid("json");

    let expiresAt: Date | null;
    let expiresAtSec: number | undefined;
    if (body.no_expiry) {
      expiresAt = null;
      expiresAtSec = undefined;
    } else if (body.expires_at) {
      expiresAt = new Date(body.expires_at);
      expiresAtSec = Math.floor(expiresAt.getTime() / 1000);
    } else {
      expiresAt = new Date(
        Date.now() + DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000,
      );
      expiresAtSec = Math.floor(expiresAt.getTime() / 1000);
    }

    const issued = await issueApiKey(auth.userId, expiresAtSec);

    await db.insert(apiKeys).values({
      userId: auth.userId,
      jwtKid: issued.kid,
      keyPrefix: issued.keyPrefix,
      name: body.display_name,
      expiresAt,
    });

    return c.json(
      {
        data: {
          api_key: issued.token,
          key_prefix: issued.keyPrefix,
        },
      },
      201,
    );
  })
  .delete("/:id", async (c) => {
    const auth = c.get("authResult");
    const id = c.req.param("id");
    const result = await db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, auth.userId)))
      .returning({ id: apiKeys.id });
    if (result.length === 0) {
      return c.json({ error: "api key not found" }, 404);
    }
    return c.json({ data: { success: true } });
  });

export default app;
