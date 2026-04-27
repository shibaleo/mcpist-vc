/**
 * /api/v1/oauth/token — OAuth 2.0 token endpoint (authorization_code grant).
 *
 *   POST application/x-www-form-urlencoded
 *     grant_type=authorization_code
 *     code=<JWT issued by /oauth/authorize>
 *     redirect_uri=<must match the value used at authorize>
 *     client_id=<must match the value used at authorize>
 *     code_verifier=<PKCE verifier — sha256 must match codeChallenge>
 *
 * Response: an mcpist API key (Ed25519 JWT) wrapped as an OAuth Bearer.
 * The token is also persisted to `mcpist.api_keys` so the user can see
 * (and revoke) it from the API Keys page.
 */

import { Hono } from "hono";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";
import { issueApiKey } from "@/lib/api-key";
import { consumeCode } from "@/lib/oauth-server/codes";

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const TOKEN_TTL_S = 24 * 60 * 60; // 24 hours

const app = new Hono().post("/", async (c) => {
  // Form-urlencoded parsing — the OAuth spec mandates this content type.
  const body = await c.req.parseBody();
  const grantType = String(body.grant_type ?? "");
  const code = String(body.code ?? "");
  const redirectUri = String(body.redirect_uri ?? "");
  const clientId = String(body.client_id ?? "");
  const codeVerifier = String(body.code_verifier ?? "");

  if (grantType !== "authorization_code") {
    return c.json(
      { error: "unsupported_grant_type", error_description: "only authorization_code is supported" },
      400,
    );
  }
  if (!code || !redirectUri || !clientId || !codeVerifier) {
    return c.json(
      {
        error: "invalid_request",
        error_description: "code, redirect_uri, client_id, and code_verifier are required",
      },
      400,
    );
  }

  let payload;
  try {
    payload = await consumeCode(code);
  } catch (e) {
    return c.json(
      {
        error: "invalid_grant",
        error_description: e instanceof Error ? e.message : "invalid code",
      },
      400,
    );
  }

  // PKCE binding: code was issued under the SHA-256(verifier) value the
  // client sent at authorize time. The verifier itself only travels at
  // token time, so an intercepted code is useless without it.
  const expected = await sha256Base64Url(codeVerifier);
  if (expected !== payload.codeChallenge) {
    return c.json(
      { error: "invalid_grant", error_description: "PKCE verification failed" },
      400,
    );
  }

  if (redirectUri !== payload.redirectUri) {
    return c.json(
      { error: "invalid_grant", error_description: "redirect_uri mismatch" },
      400,
    );
  }
  if (clientId !== payload.clientId) {
    return c.json(
      { error: "invalid_grant", error_description: "client_id mismatch" },
      400,
    );
  }

  const expiresAtSec = Math.floor(Date.now() / 1000) + TOKEN_TTL_S;
  const issued = await issueApiKey(payload.userId, expiresAtSec);

  // Persist so the key shows up on the API Keys page (and can be revoked).
  await db.insert(apiKeys).values({
    userId: payload.userId,
    jwtKid: issued.kid,
    keyPrefix: issued.keyPrefix,
    name: `OAuth: ${payload.clientId.slice(0, 24)}`,
    expiresAt: new Date(expiresAtSec * 1000),
  });

  return c.json({
    access_token: issued.token,
    token_type: "Bearer",
    expires_in: TOKEN_TTL_S,
    scope: payload.scope ?? "",
  });
});

export default app;
