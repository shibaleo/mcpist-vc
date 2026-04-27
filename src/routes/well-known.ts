/**
 * .well-known endpoints for MCP OAuth discovery.
 *
 * mcpist defers OAuth to Clerk — Clerk is a full OAuth 2.1 + DCR + PKCE
 * authorization server, so we just publish the discovery metadata that
 * points clients (Claude.ai, Claude Desktop, ...) at Clerk for the
 * authorize/token/register dance.
 *
 * Mounted at both /api/v1/.well-known/* (canonical) and /.well-known/*
 * (root, via vercel.json rewrite) so MCP clients that look in either
 * spot find the metadata.
 */

import { Hono } from "hono";
import { getAppUrl } from "@/lib/app-url";

function getClerkIssuer(): string | null {
  const pk = process.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (!pk) return null;
  const encoded = pk.replace(/^pk_(test|live)_/, "");
  try {
    const domain = atob(encoded).replace(/\$$/, "");
    return `https://${domain}`;
  } catch {
    return null;
  }
}

const corsAndCacheHeaders = {
  "Cache-Control": "public, max-age=3600",
  "Access-Control-Allow-Origin": "*",
};

const app = new Hono()
  /**
   * RFC 9728 Protected Resource Metadata. Tells the MCP client which
   * authorization server to talk to and what bearer-token shape we accept.
   */
  .get("/oauth-protected-resource", (c) => {
    const appUrl = getAppUrl(c.req.raw);
    const issuer = getClerkIssuer();
    if (!issuer) {
      return c.json({ error: "Clerk not configured" }, 500);
    }
    const metadata = {
      resource: `${appUrl}/api/v1/mcp`,
      authorization_servers: [issuer],
      scopes_supported: ["openid", "profile", "email"],
      bearer_methods_supported: ["header"],
    };
    return c.json(metadata, 200, corsAndCacheHeaders);
  })
  /**
   * RFC 8414 Authorization Server Metadata. Proxies Clerk's own metadata —
   * Claude.ai will use the endpoints (authorize_endpoint, token_endpoint,
   * registration_endpoint) declared by Clerk.
   *
   * We proxy rather than redirect so CORS-restricted browser clients see
   * the metadata served from our own origin.
   */
  .get("/oauth-authorization-server", async (c) => {
    const issuer = getClerkIssuer();
    if (!issuer) {
      return c.json({ error: "Clerk not configured" }, 500);
    }
    try {
      const upstream = await fetch(
        `${issuer}/.well-known/oauth-authorization-server`,
      );
      if (!upstream.ok) {
        return c.json(
          {
            error: `clerk metadata fetch failed: ${upstream.status}`,
          },
          502,
        );
      }
      const metadata = await upstream.json();
      return c.json(metadata, 200, corsAndCacheHeaders);
    } catch (e) {
      return c.json(
        {
          error: e instanceof Error ? e.message : "fetch failed",
        },
        502,
      );
    }
  });

export default app;
