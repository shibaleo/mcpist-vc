/**
 * /api/v1/oauth/token — OAuth 2.0 token endpoint.
 *
 * Two grants:
 *
 *   grant_type=authorization_code
 *     code, redirect_uri, client_id, code_verifier  (PKCE)
 *
 *   grant_type=refresh_token
 *     refresh_token, client_id
 *
 * Both branches issue an mcpist API key (Ed25519 JWT) wrapped as an OAuth
 * Bearer access token, plus a fresh 90-day refresh token. The access
 * token row is persisted to `mcpist.api_keys` so the user can see and
 * revoke it from the API Keys page.
 */

import { Hono } from "hono";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";
import { issueApiKey } from "@/lib/api-key";
import { consumeCode } from "@/lib/oauth-server/codes";
import {
  signRefreshToken,
  verifyRefreshToken,
  REFRESH_TTL_S,
} from "@/lib/oauth-server/refresh-tokens";

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

interface IssueResult {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in: number;
  scope: string;
}

/**
 * Mint an access token + refresh token for `userId`, persist the access
 * token to api_keys, and return the OAuth-shaped response body.
 */
async function issueTokens(
  userId: string,
  clientId: string,
  scope: string | undefined,
): Promise<IssueResult> {
  const accessExpiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_S;
  const issued = await issueApiKey(userId, accessExpiresAt);

  await db.insert(apiKeys).values({
    userId,
    jwtKid: issued.kid,
    keyPrefix: issued.keyPrefix,
    name: `OAuth: ${clientId.slice(0, 24)}`,
    expiresAt: new Date(accessExpiresAt * 1000),
  });

  const refresh = await signRefreshToken({ userId, clientId, scope });

  return {
    access_token: issued.token,
    token_type: "Bearer",
    expires_in: TOKEN_TTL_S,
    refresh_token: refresh,
    refresh_token_expires_in: REFRESH_TTL_S,
    scope: scope ?? "",
  };
}

const app = new Hono().post("/", async (c) => {
  const body = await c.req.parseBody();
  const grantType = String(body.grant_type ?? "");
  const clientId = String(body.client_id ?? "");

  // ── Authorization-code grant ─────────────────────────────────────────
  if (grantType === "authorization_code") {
    const code = String(body.code ?? "");
    const redirectUri = String(body.redirect_uri ?? "");
    const codeVerifier = String(body.code_verifier ?? "");

    if (!code || !redirectUri || !clientId || !codeVerifier) {
      return c.json(
        {
          error: "invalid_request",
          error_description:
            "code, redirect_uri, client_id, and code_verifier are required",
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

    // PKCE binding: code was issued under SHA-256(verifier) the client sent
    // at authorize time. The verifier only travels at token time, so an
    // intercepted code is useless without it.
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

    const tokens = await issueTokens(payload.userId, clientId, payload.scope);
    return c.json(tokens);
  }

  // ── Refresh-token grant ──────────────────────────────────────────────
  if (grantType === "refresh_token") {
    const refreshToken = String(body.refresh_token ?? "");
    if (!refreshToken || !clientId) {
      return c.json(
        {
          error: "invalid_request",
          error_description: "refresh_token and client_id are required",
        },
        400,
      );
    }
    let payload;
    try {
      payload = await verifyRefreshToken(refreshToken);
    } catch (e) {
      return c.json(
        {
          error: "invalid_grant",
          error_description:
            e instanceof Error ? e.message : "invalid refresh token",
        },
        400,
      );
    }
    if (clientId !== payload.clientId) {
      return c.json(
        { error: "invalid_grant", error_description: "client_id mismatch" },
        400,
      );
    }
    const tokens = await issueTokens(payload.userId, clientId, payload.scope);
    return c.json(tokens);
  }

  return c.json(
    {
      error: "unsupported_grant_type",
      error_description:
        "only authorization_code and refresh_token are supported",
    },
    400,
  );
});

export default app;
