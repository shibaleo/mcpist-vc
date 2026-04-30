/**
 * /api/v1/oauth/authorize — OAuth 2.0 authorization endpoint.
 *
 * Flow:
 *   1. Validate request parameters (response_type, client_id, redirect_uri,
 *      code_challenge, code_challenge_method).
 *   2. Look for an owner Clerk session via cookie. If absent (or not the
 *      owner), redirect the user to /oauth/consent.
 *   3. Issue a short-lived authorization code (signed JWT) and 302 to the
 *      client's redirect_uri with `?code=...&state=...`.
 *
 * No client storage — we accept any client_id (PKCE provides the security
 * binding between authorize and token).
 */

import { Hono } from "hono";
import { authenticateClerkOwner } from "@/lib/auth";
import { signCode } from "@/lib/oauth-server/codes";

const app = new Hono().get("/", async (c) => {
  const url = new URL(c.req.url);
  const params = url.searchParams;

  const responseType = params.get("response_type");
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const state = params.get("state");
  const codeChallenge = params.get("code_challenge");
  const codeChallengeMethod = params.get("code_challenge_method");
  const scope = params.get("scope");

  if (responseType !== "code") {
    return c.json(
      { error: "unsupported_response_type", error_description: "only `code` is supported" },
      400,
    );
  }
  if (!clientId || !redirectUri || !codeChallenge) {
    return c.json(
      {
        error: "invalid_request",
        error_description: "client_id, redirect_uri, and code_challenge are required",
      },
      400,
    );
  }
  if (codeChallengeMethod !== "S256") {
    return c.json(
      {
        error: "invalid_request",
        error_description: "code_challenge_method must be S256",
      },
      400,
    );
  }
  try {
    new URL(redirectUri);
  } catch {
    return c.json(
      { error: "invalid_request", error_description: "redirect_uri must be an absolute URL" },
      400,
    );
  }

  const auth = await authenticateClerkOwner(c.req.raw);
  if (!auth) {
    // Ship the whole query forward so the consent round-trip preserves
    // PKCE / state. The SPA AuthGate handles Clerk login, then bounces
    // back here with the cookie set.
    const consentTarget = `/oauth/consent${url.search}`;
    return c.redirect(consentTarget);
  }

  const code = await signCode({
    clientId,
    redirectUri,
    codeChallenge,
    scope: scope ?? undefined,
  });

  const target = new URL(redirectUri);
  target.searchParams.set("code", code);
  if (state) target.searchParams.set("state", state);

  return c.redirect(target.toString());
});

export default app;
