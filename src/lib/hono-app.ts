import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { authenticate, type AuthResult } from "@/lib/auth";
import { getAppUrl } from "@/lib/app-url";

console.log("[boot] hono-app: module load");

export type Env = { Variables: { authResult: AuthResult } };

import health from "@/routes/health";
import publicModules from "@/routes/modules";
import mcp from "@/routes/mcp";
import meCredentials from "@/routes/me/credentials";
import meApiKeys from "@/routes/me/api-keys";
import meModules from "@/routes/me/modules";
import meOAuth from "@/routes/me/oauth";
import adminOAuthApps from "@/routes/admin/oauth-apps";
import oauthCallback from "@/routes/oauth-callback";
import wellKnown from "@/routes/well-known";

/* ── V1 API sub-app ──
 *
 * Routes are chained so the accumulated route schema is preserved in the
 * app's type — required for Hono RPC (`hc<AppType>`).
 *
 * Order matters:
 *   1. cross-cutting middleware (logger, request trace, onError)
 *   2. public routes (health, modules listing, plans)
 *   3. auth middleware
 *   4. protected routes (everything under /me, plus /mcp)
 */

const v1 = new Hono<Env>()
  .use("*", logger())
  // CORS — required for browser-based MCP clients (Claude.ai, ChatGPT, ...).
  // Must come before the auth gate so OPTIONS preflight succeeds without
  // a bearer token. `exposeHeaders` is what lets the client's JS actually
  // read WWW-Authenticate (browsers hide it from `fetch().headers` by
  // default, breaking OAuth discovery).
  .use(
    "*",
    cors({
      origin: (origin) => origin ?? "*",
      allowMethods: ["GET", "POST", "OPTIONS", "PUT", "DELETE"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "Mcp-Session-Id",
        "Mcp-Protocol-Version",
      ],
      exposeHeaders: ["WWW-Authenticate", "Mcp-Session-Id"],
      credentials: false,
      maxAge: 3600,
    }),
  )
  .use("*", async (c, next) => {
    const start = Date.now();
    const path = c.req.path;
    const method = c.req.method;
    console.log(`[req] start ${method} ${path}`);
    try {
      await next();
      console.log(
        `[req] done ${method} ${path} status=${c.res.status} ms=${Date.now() - start}`,
      );
    } catch (e) {
      console.error(
        `[req] error ${method} ${path} ms=${Date.now() - start}:`,
        e instanceof Error ? `${e.message}\n${e.stack}` : e,
      );
      throw e;
    }
  })
  .onError((err, c) => {
    console.error("[onError]", err);
    const causeMsg = err.cause instanceof Error ? err.cause.message : "";
    const msg = causeMsg
      ? `${err.message} - ${causeMsg}`
      : err.message || "Internal Server Error";
    return c.json({ error: msg }, 500);
  })
  // Public
  .route("/health", health)
  .route("/modules", publicModules)
  // OAuth callback is public — auth is carried in the signed `state` JWT
  // emitted by /me/oauth/start, not in any session cookie or bearer token.
  .route("/oauth/callback", oauthCallback)
  // MCP OAuth discovery endpoints (RFC 9728 + RFC 8414).
  .route("/.well-known", wellKnown)
  // Auth gate
  .use("*", async (c, next) => {
    // Public paths within v1: well-known discovery + already-mounted health
    // / modules / oauth/callback. Hono's `.use("*")` applies to every route
    // including those registered earlier, so we skip explicitly.
    const path = c.req.path;
    if (
      path.startsWith("/api/v1/.well-known/") ||
      path === "/api/v1/health" ||
      path === "/api/v1/health/diag" ||
      path === "/api/v1/modules" ||
      path === "/api/v1/oauth/callback"
    ) {
      return next();
    }
    const result = await authenticate(c.req.raw);
    if (!result) {
      // RFC 9728 §5.1: include resource_metadata so MCP clients can
      // discover the authorization server and start the OAuth flow.
      const appUrl = getAppUrl(c.req.raw);
      const resourceMetadata = `${appUrl}/api/v1/.well-known/oauth-protected-resource`;
      return c.json(
        { error: "Unauthorized" },
        401,
        {
          "WWW-Authenticate": `Bearer realm="mcpist", resource_metadata="${resourceMetadata}"`,
        },
      );
    }
    c.set("authResult", result);
    await next();
  })
  // Protected
  .route("/mcp", mcp)
  .route("/me/credentials", meCredentials)
  .route("/me/api-keys", meApiKeys)
  .route("/me/modules", meModules)
  .route("/me/oauth", meOAuth)
  .route("/admin/oauth-apps", adminOAuthApps)
  // `/me` is the canonical "am I logged in" probe used by AuthGate.
  .get("/me", (c) => {
    const a = c.get("authResult");
    return c.json({
      data: {
        id: a.userId,
        name: a.displayName ?? "",
        email: a.email ?? "",
      },
    });
  });

const app = new Hono().basePath("/api").route("/v1", v1);

export default app;

export type AppType = typeof app;
