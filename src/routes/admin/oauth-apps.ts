/**
 * /api/v1/admin/oauth-apps — CRUD on `mcpist.oauth_apps`.
 *
 *   GET  /          List configured providers (with credential metadata only).
 *   PUT  /:provider Upsert client_id / client_secret / redirect_uri / enabled.
 *   DELETE /:provider Drop the row entirely.
 *
 * No admin role gate — single-user deployment per the project's scope.
 * If we ever go multi-tenant, add a `requireAdmin` middleware here without
 * touching the route bodies.
 *
 * client_secret is encrypted with the same AES-GCM key that protects
 * user_credentials. The endpoint never returns the decrypted value — the
 * only place secrets are decrypted is the OAuth flow at authorize / token
 * exchange time.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, asc } from "drizzle-orm";
import type { Env } from "@/lib/hono-app";
import { db } from "@/lib/db";
import { oauthApps } from "@/lib/db/schema";
import { encrypt } from "@/lib/credentials/crypto";
import { PROVIDER_CATALOG } from "@/lib/oauth/providers";

const upsertBody = z.object({
  client_id: z.string().min(1),
  /**
   * Empty string means "leave existing secret unchanged" — for the edit
   * dialog where the admin only wants to update client_id or redirect_uri
   * without re-pasting the whole secret. New rows reject empty.
   */
  client_secret: z.string(),
  redirect_uri: z.string().optional(),
  enabled: z.boolean().optional(),
});

const app = new Hono<Env>()
  .get("/", async (c) => {
    const rows = await db
      .select({
        provider: oauthApps.provider,
        clientId: oauthApps.clientId,
        redirectUri: oauthApps.redirectUri,
        enabled: oauthApps.enabled,
        createdAt: oauthApps.createdAt,
        updatedAt: oauthApps.updatedAt,
      })
      .from(oauthApps)
      .orderBy(asc(oauthApps.provider));

    // Always return one row per supported provider so the UI can render the
    // full grid (configured + not-configured) without merging on the client.
    const byProvider = new Map(rows.map((r) => [r.provider, r]));
    const data = PROVIDER_CATALOG.map((p) => {
      const row = byProvider.get(p.id);
      return {
        provider: p.id,
        name: p.name,
        description: p.description,
        docs_url: p.docsUrl,
        configured: !!row,
        client_id: row?.clientId ?? null,
        redirect_uri: row?.redirectUri ?? null,
        enabled: row?.enabled ?? null,
        updated_at: row?.updatedAt?.toISOString() ?? null,
      };
    });

    return c.json({ data });
  })
  .put("/:provider", zValidator("json", upsertBody), async (c) => {
    const provider = c.req.param("provider");
    const body = c.req.valid("json");

    if (!PROVIDER_CATALOG.some((p) => p.id === provider)) {
      return c.json({ error: `unknown provider: ${provider}` }, 400);
    }

    const existing = await db
      .select({ provider: oauthApps.provider })
      .from(oauthApps)
      .where(eq(oauthApps.provider, provider))
      .limit(1);

    // Only encrypt and overwrite the secret when the client actually sent
    // a non-empty value. For new rows, an empty secret is a hard error.
    if (body.client_secret === "") {
      if (existing.length === 0) {
        return c.json(
          { error: "client_secret is required for new providers" },
          400,
        );
      }
      await db
        .update(oauthApps)
        .set({
          clientId: body.client_id,
          redirectUri: body.redirect_uri ?? null,
          enabled: body.enabled ?? true,
          updatedAt: new Date(),
        })
        .where(eq(oauthApps.provider, provider));
    } else {
      const enc = await encrypt(body.client_secret);
      await db
        .insert(oauthApps)
        .values({
          provider,
          clientId: body.client_id,
          encryptedClientSecret: enc,
          redirectUri: body.redirect_uri ?? null,
          enabled: body.enabled ?? true,
        })
        .onConflictDoUpdate({
          target: oauthApps.provider,
          set: {
            clientId: body.client_id,
            encryptedClientSecret: enc,
            redirectUri: body.redirect_uri ?? null,
            enabled: body.enabled ?? true,
            updatedAt: new Date(),
          },
        });
    }

    return c.json({ data: { success: true, provider } });
  })
  .delete("/:provider", async (c) => {
    const provider = c.req.param("provider");
    const result = await db
      .delete(oauthApps)
      .where(eq(oauthApps.provider, provider))
      .returning({ provider: oauthApps.provider });
    if (result.length === 0) {
      return c.json({ error: "provider not found" }, 404);
    }
    return c.json({ data: { success: true } });
  });

export default app;
