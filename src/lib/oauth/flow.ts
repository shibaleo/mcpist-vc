/**
 * OAuth 2.0 authorization-code-with-PKCE flow helpers.
 *
 * Vercel Functions are stateless, so we encode the per-request context
 * (userId, module, redirect target, PKCE verifier) in a short-lived signed
 * `state` JWT instead of session storage. The provider returns the same
 * state opaque-ly on the callback and we verify-then-decode.
 *
 * Signing reuses SERVER_JWT_SIGNING_KEY (Ed25519). The audience claim
 * "oauth-state" prevents an issued state token from being usable as an
 * MCP API key (those carry no `aud`).
 */

import * as jose from "jose";
import {
  getProvider,
  getProviderCredentials,
  moduleProvider,
  type OAuthProvider,
} from "./providers";
import { upsertModuleCredentials } from "@/lib/credentials/broker";
import { loadEd25519Keypair } from "@/lib/ed25519";

const STATE_TTL_S = 10 * 60; // 10 minutes — generous for the user to log in
const STATE_AUDIENCE = "oauth-state";

interface StatePayload {
  userId: string;
  module: string;
  redirect: string;
  /** PKCE code_verifier — required for the code exchange. */
  verifier: string;
}

function loadKeys() {
  const { privateKey, publicKey } = loadEd25519Keypair();
  return { sign: privateKey, verify: publicKey };
}

// ── PKCE ──────────────────────────────────────────────────────────────────

function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomVerifier(): string {
  const buf = new Uint8Array(new ArrayBuffer(32));
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return base64UrlEncode(digest);
}

// ── State encoding ────────────────────────────────────────────────────────

async function signState(payload: StatePayload): Promise<string> {
  const { sign } = loadKeys();
  return new jose.SignJWT({ ...payload })
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuedAt()
    .setAudience(STATE_AUDIENCE)
    .setExpirationTime(Math.floor(Date.now() / 1000) + STATE_TTL_S)
    .sign(sign);
}

async function verifyState(token: string): Promise<StatePayload> {
  const { verify } = loadKeys();
  const { payload } = await jose.jwtVerify(token, verify, {
    audience: STATE_AUDIENCE,
    algorithms: ["EdDSA"],
  });
  if (
    typeof payload.userId !== "string" ||
    typeof payload.module !== "string" ||
    typeof payload.redirect !== "string" ||
    typeof payload.verifier !== "string"
  ) {
    throw new Error("invalid state payload");
  }
  return {
    userId: payload.userId,
    module: payload.module,
    redirect: payload.redirect,
    verifier: payload.verifier,
  };
}

// ── Public API ────────────────────────────────────────────────────────────

export interface AuthorizeUrlInput {
  module: string;
  userId: string;
  /** Where to send the browser after the callback finishes (relative path). */
  redirectAfter: string;
  /** Fixed callback registered with the provider — typically derived from request host. */
  callbackUrl: string;
}

/** Build the provider's authorize URL. Returns null if the provider isn't configured. */
export async function buildAuthorizeUrl(
  input: AuthorizeUrlInput,
): Promise<string | null> {
  const provider = getProvider(moduleProvider(input.module));
  if (!provider) return null;
  const creds = await getProviderCredentials(provider);
  if (!creds) return null;

  // The admin can override the redirect URI per-app (e.g. a stable prod URL
  // even when the dev box's host changes). Falls back to the request-derived
  // callback URL when not set.
  const redirectUri = creds.redirectUri || input.callbackUrl;

  const verifier = randomVerifier();
  const challenge = await pkceChallenge(verifier);
  const state = await signState({
    userId: input.userId,
    module: input.module,
    redirect: input.redirectAfter,
    verifier,
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (provider.defaultScopes) params.set("scope", provider.defaultScopes);
  for (const [k, v] of Object.entries(provider.extraAuthorizeParams ?? {})) {
    params.set(k, v);
  }

  return `${provider.authorizeUrl}?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  // Notion specifically returns these:
  workspace_id?: string;
  workspace_name?: string;
  bot_id?: string;
}

/**
 * Exchange the authorization code for tokens, then persist via the broker.
 * Returns the resolved (userId, module) so the caller can redirect.
 */
export async function completeCallback(input: {
  code: string;
  state: string;
  callbackUrl: string;
}): Promise<{ userId: string; module: string; redirect: string }> {
  const decoded = await verifyState(input.state);
  const provider = getProvider(moduleProvider(decoded.module));
  if (!provider) throw new Error(`unknown module: ${decoded.module}`);
  const creds = await getProviderCredentials(provider);
  if (!creds) throw new Error(`provider ${provider.id} not configured`);

  // Match the redirect_uri sent at authorize time — providers compare it byte-for-byte.
  const callbackUrl = creds.redirectUri || input.callbackUrl;

  const tokenResp = await exchangeCode({
    provider,
    creds,
    code: input.code,
    verifier: decoded.verifier,
    callbackUrl,
  });

  if (!tokenResp.access_token) {
    throw new Error("provider returned no access_token");
  }

  const expiresAt =
    typeof tokenResp.expires_in === "number"
      ? Math.floor(Date.now() / 1000) + tokenResp.expires_in
      : undefined;

  await upsertModuleCredentials(decoded.userId, decoded.module, {
    authType: "oauth2",
    accessToken: tokenResp.access_token,
    refreshToken: tokenResp.refresh_token,
    expiresAt,
    metadata: {
      // Pass through provider-specific extras (e.g. Notion's workspace info)
      // for downstream module use without losing the data.
      workspaceId: tokenResp.workspace_id,
      workspaceName: tokenResp.workspace_name,
      botId: tokenResp.bot_id,
      scope: tokenResp.scope,
    },
  });

  return {
    userId: decoded.userId,
    module: decoded.module,
    redirect: decoded.redirect,
  };
}

async function exchangeCode(input: {
  provider: OAuthProvider;
  creds: { clientId: string; clientSecret: string };
  code: string;
  verifier: string;
  callbackUrl: string;
}): Promise<TokenResponse> {
  const { provider, creds } = input;
  const headers: Record<string, string> = {};
  let body: string;

  const baseFields: Record<string, string> = {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.callbackUrl,
    code_verifier: input.verifier,
    ...(provider.extraTokenParams ?? {}),
  };

  if (provider.tokenAuthMethod === "basic") {
    headers.Authorization = `Basic ${btoa(`${creds.clientId}:${creds.clientSecret}`)}`;
  } else {
    baseFields.client_id = creds.clientId;
    baseFields.client_secret = creds.clientSecret;
  }

  if (provider.tokenContentType === "json") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(baseFields);
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(baseFields).toString();
  }

  const res = await fetch(provider.tokenUrl, {
    method: "POST",
    headers,
    body,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `token endpoint returned ${res.status}: ${errText.slice(0, 200)}`,
    );
  }
  return (await res.json()) as TokenResponse;
}
