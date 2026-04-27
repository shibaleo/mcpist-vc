/**
 * /api/v1/oauth/register — Dynamic Client Registration proxy (RFC 7591).
 *
 * MCP spec requires DCR but Clerk's well-known metadata doesn't expose
 * `registration_endpoint`. Clerk DOES allow OAuth-app creation via the
 * admin API (`POST https://api.clerk.com/v1/oauth_applications`), so we
 * front it with this endpoint:
 *
 *   1. Accept the DCR request from the MCP client.
 *   2. Translate to Clerk's admin-API shape and create the application.
 *   3. Return the new client_id back in RFC 7591 format.
 *
 * Public-client only (PKCE-protected) — we never hand out a client_secret.
 * That matches Claude.ai / ChatGPT / Claude Desktop's flow.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const dcrBody = z.object({
  redirect_uris: z.array(z.string().url()).min(1),
  client_name: z.string().optional(),
  scope: z.string().optional(),
  // Other fields (token_endpoint_auth_method, grant_types, etc.) are
  // accepted but not forwarded — Clerk picks defaults.
});

interface ClerkOAuthApp {
  id: string;
  client_id: string;
  /** Returned by Clerk only for confidential clients. */
  client_secret?: string;
  /**
   * Clerk's API uses `callback_url` (singular). The response field name
   * has varied across API versions; we tolerate either.
   */
  callback_url?: string;
  callback_urls?: string[];
  scopes: string;
  name: string;
}

const app = new Hono().post(
  "/",
  zValidator("json", dcrBody),
  async (c) => {
    const body = c.req.valid("json");
    const clerkSecret = process.env.CLERK_SECRET_KEY;
    if (!clerkSecret) {
      return c.json({ error: "Clerk admin API not configured" }, 500);
    }

    // Clerk's admin API for OAuth app creation. Public client (PKCE) so no
    // secret is generated; the client authenticates with `code_verifier`
    // alone at the token endpoint.
    //
    // Clerk takes `callback_url` (singular). MCP clients pass an array
    // of redirect_uris (DCR/RFC 7591), but Clerk only stores one — we
    // register the first and rely on it matching the authorize request.
    const res = await fetch(
      "https://api.clerk.com/v1/oauth_applications",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${clerkSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: body.client_name ?? "MCP client",
          callback_url: body.redirect_uris[0],
          scopes: body.scope ?? "openid profile email",
          public: true,
        }),
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[oauth-register] Clerk admin API failed:", res.status, errText);
      return c.json(
        {
          error: "registration_failed",
          error_description: `Clerk returned ${res.status}: ${errText.slice(0, 300)}`,
        },
        502,
      );
    }

    const created = (await res.json()) as ClerkOAuthApp;
    const registeredCallbacks =
      created.callback_urls ??
      (created.callback_url ? [created.callback_url] : body.redirect_uris);

    // RFC 7591 response shape.
    return c.json({
      client_id: created.client_id,
      // No client_secret because we requested a public client.
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: registeredCallbacks,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: created.scopes,
      client_name: created.name,
    });
  },
);

export default app;
