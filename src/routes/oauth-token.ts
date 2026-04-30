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
 * Both branches issue a 24h Ed25519 access-token JWT plus a fresh 90-day
 * refresh-token JWT. Stateless — no DB row, no per-token revocation.
 */

import { Hono } from "hono";
import { issueAccessToken, ACCESS_TOKEN_TTL_S } from "@/lib/oauth-server/access-tokens";
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

interface IssueResult {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in: number;
  scope: string;
}

async function issueTokens(
  clientId: string,
  scope: string | undefined,
): Promise<IssueResult> {
  const access = await issueAccessToken(clientId, scope);
  const refresh = await signRefreshToken({ clientId, scope });
  return {
    access_token: access.token,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_S,
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

    const tokens = await issueTokens(clientId, payload.scope);
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
    const tokens = await issueTokens(clientId, payload.scope);
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
