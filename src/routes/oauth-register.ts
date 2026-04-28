/**
 * /api/v1/oauth/register — Dynamic Client Registration (RFC 7591).
 *
 * No actual storage. We generate a random client_id and echo back the
 * client's requested redirect_uris. The authorize/token endpoints don't
 * look up any client record — PKCE provides the security binding, and
 * the (redirect_uri, client_id, code_challenge) tuple is encoded into
 * the authorization code JWT itself, so it can't be tampered with.
 *
 * This is the minimum DCR surface MCP clients need to discover that
 * registration is "supported" and obtain a client_id.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const dcrBody = z.object({
  redirect_uris: z.array(z.string().url()).min(1),
  client_name: z.string().optional(),
  scope: z.string().optional(),
  // Other RFC 7591 fields (token_endpoint_auth_method, grant_types, ...)
  // are accepted-but-ignored.
});

const app = new Hono().post("/", zValidator("json", dcrBody), async (c) => {
  const body = c.req.valid("json");

  // Random opaque client_id. Doesn't need to map to anything we store —
  // the authorize endpoint accepts any value and binds the (client_id,
  // redirect_uri, code_challenge) into the authorization-code JWT.
  const clientId = `mcpist_${crypto.randomUUID()}`;

  return c.json({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: body.redirect_uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: body.scope ?? "openid profile email",
    client_name: body.client_name ?? "MCP client",
  });
});

export default app;
