/**
 * /api/v1/me/oauth — kick off provider authorize flow.
 *
 *   GET /providers              List providers configured at boot.
 *   GET /start?module=<name>&redirect=<path>
 *      → { authorize_url } — caller does `window.location = authorize_url`.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Env } from "@/lib/hono-app";
import { listConfiguredProviders } from "@/lib/oauth/providers";
import { buildAuthorizeUrl } from "@/lib/oauth/flow";
import { getOAuthCallbackUrl } from "@/lib/app-url";

const startQuery = z.object({
  module: z.string().min(1),
  redirect: z.string().optional(),
});

const app = new Hono<Env>()
  .get("/providers", async (c) => {
    return c.json({ data: await listConfiguredProviders() });
  })
  .get("/start", zValidator("query", startQuery), async (c) => {
    const auth = c.get("authResult");
    const { module, redirect } = c.req.valid("query");
    const callbackUrl = getOAuthCallbackUrl(c.req.raw);
    const authorize = await buildAuthorizeUrl({
      module,
      userId: auth.userId,
      redirectAfter: redirect ?? "/credentials",
      callbackUrl,
    });
    if (!authorize) {
      return c.json(
        { error: `oauth not configured for module ${module}` },
        400,
      );
    }
    return c.json({ data: { authorize_url: authorize } });
  });

export default app;
