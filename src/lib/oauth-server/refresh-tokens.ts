/**
 * Refresh tokens.
 *
 * 90-day signed JWTs issued alongside an access token. The token endpoint
 * accepts `grant_type=refresh_token` and trades a valid refresh JWT for a
 * fresh 24-hour access token.
 *
 * Non-rotating: the same refresh token stays valid until its expiry, so
 * Claude.ai can keep refreshing without ever needing user re-consent for
 * 90 days. Single-user setup — no per-token revocation; rotate
 * SERVER_JWT_SIGNING_KEY's kid to invalidate all.
 */

import * as jose from "jose";
import { loadEd25519Keypair } from "@/lib/ed25519";

const TTL_S = 90 * 24 * 60 * 60; // 90 days
const AUDIENCE = "mcpist-oauth-refresh";

export interface RefreshPayload {
  clientId: string;
  scope?: string;
}

export async function signRefreshToken(payload: RefreshPayload): Promise<string> {
  const { privateKey } = loadEd25519Keypair();
  return new jose.SignJWT({ ...payload })
    .setProtectedHeader({ alg: "EdDSA" })
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setAudience(AUDIENCE)
    .setExpirationTime(Math.floor(Date.now() / 1000) + TTL_S)
    .sign(privateKey);
}

export async function verifyRefreshToken(token: string): Promise<RefreshPayload> {
  const { publicKey } = loadEd25519Keypair();
  const { payload } = await jose.jwtVerify(token, publicKey, {
    audience: AUDIENCE,
    algorithms: ["EdDSA"],
  });
  if (typeof payload.clientId !== "string") {
    throw new Error("invalid refresh token payload");
  }
  return {
    clientId: payload.clientId,
    scope: typeof payload.scope === "string" ? payload.scope : undefined,
  };
}

export const REFRESH_TTL_S = TTL_S;
