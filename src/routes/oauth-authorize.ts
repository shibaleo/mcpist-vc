/**
 * /api/v1/oauth/authorize — OAuth 2.0 authorization endpoint.
 *
 * Flow:
 *   1. Validate request parameters (response_type, client_id, redirect_uri,
 *      code_challenge, code_challenge_method).
 *   2. Look for an existing Clerk session via cookie. If absent, redirect
 *      the user to /oauth/consent (the SPA AuthGate handles login, then
 *      sends the browser back here with the cookie set).
 *   3. Issue a short-lived authorization code (signed JWT) and 302 to the
 *      client's redirect_uri with `?code=...&state=...`.
 *
 * No client storage — we accept any client_id (PKCE provides the security
 * binding between authorize and token).
 */

import { Hono } from "hono";
import { authenticate } from "@/lib/auth";
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

  // Spec violations short-circuit before we touch the session.
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
  // Sanity-check the redirect_uri is parseable.
  try {
    new URL(redirectUri);
  } catch {
    return c.json(
      { error: "invalid_request", error_description: "redirect_uri must be an absolute URL" },
      400,
    );
  }

  const auth = await authenticate(c.req.raw);
  if (!auth) {
    // Ship the whole query forward to the consent page so the round-trip
    // doesn't lose the PKCE / state context. The SPA's AuthGate then
    // brings the user back here with a Clerk cookie set.
    const consentTarget = `/oauth/consent${url.search}`;
    return c.redirect(consentTarget);
  }

  const code = await signCode({
    userId: auth.userId,
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
