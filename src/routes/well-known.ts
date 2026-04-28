/**
 * .well-known endpoints for MCP OAuth discovery.
 *
 * mcpist runs its OWN OAuth Authorization Server (proxying Clerk for
 * end-user login under the hood). Discovery metadata advertises our
 * authorize / token / register endpoints — clients (Claude.ai, Claude
 * Desktop, ...) never talk to Clerk's OAuth surface directly.
 *
 * Mounted at both /api/v1/.well-known/* (canonical) and /.well-known/*
 * (apex, mounted in hono-app) so MCP clients that look in either spot
 * find the metadata.
 */

import { Hono } from "hono";
import { getAppUrl } from "@/lib/app-url";

const corsAndCacheHeaders = {
  "Cache-Control": "public, max-age=3600",
  "Access-Control-Allow-Origin": "*",
};

const app = new Hono()
  /**
   * RFC 9728 Protected Resource Metadata. Tells the MCP client that we
   * are also the authorization server and which bearer-token shape
   * we accept on /api/v1/mcp.
   */
  .get("/oauth-protected-resource", (c) => {
    const appUrl = getAppUrl(c.req.raw);
    return c.json(
      {
        resource: `${appUrl}/api/v1/mcp`,
        authorization_servers: [appUrl],
        scopes_supported: ["openid", "profile", "email"],
        bearer_methods_supported: ["header"],
      },
      200,
      corsAndCacheHeaders,
    );
  })
  /**
   * RFC 8414 Authorization Server Metadata.
   *
   * issuer matches the URL the client fetches this from (per the spec).
   * Endpoints all live on our domain — Clerk is invisible here. The
   * authorize endpoint internally checks Clerk session cookies for user
   * authentication, but that's an implementation detail.
   */
  .get("/oauth-authorization-server", (c) => {
    const appUrl = getAppUrl(c.req.raw);
    return c.json(
      {
        issuer: appUrl,
        authorization_endpoint: `${appUrl}/api/v1/oauth/authorize`,
        token_endpoint: `${appUrl}/api/v1/oauth/token`,
        registration_endpoint: `${appUrl}/api/v1/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: ["openid", "profile", "email"],
      },
      200,
      corsAndCacheHeaders,
    );
  });

export default app;
