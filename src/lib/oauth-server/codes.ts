/**
 * Authorization-code JWTs.
 *
 * Stateless OAuth — codes are signed JWTs that carry the (client_id,
 * redirect_uri, code_challenge, scope) tuple from the authorize request.
 * The token endpoint verifies the signature, expiry, and PKCE binding,
 * then issues an access token. No DB row needed.
 *
 * No userId — single-owner mode. The fact that a code was minted at all
 * means the owner already passed Clerk consent at /authorize.
 *
 * Single-use enforcement: the JWT's `jti` is checked against an in-memory
 * used-codes set. The set lives only as long as the warm Lambda does —
 * replay attacks within the same warm container are blocked, but a code
 * might be replayable across a cold-start. The 5-minute TTL keeps the
 * window short.
 */

import * as jose from "jose";
import { loadEd25519Keypair } from "@/lib/ed25519";

const CODE_TTL_S = 300; // 5 minutes
const AUDIENCE = "mcpist-oauth-code";

export interface CodePayload {
  clientId: string;
  redirectUri: string;
  /** Base64url-encoded SHA-256 of the verifier (S256). */
  codeChallenge: string;
  scope?: string;
}

const usedJtis = new Set<string>();

export async function signCode(payload: CodePayload): Promise<string> {
  const { privateKey } = loadEd25519Keypair();
  return new jose.SignJWT({ ...payload })
    .setProtectedHeader({ alg: "EdDSA" })
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setAudience(AUDIENCE)
    .setExpirationTime(Math.floor(Date.now() / 1000) + CODE_TTL_S)
    .sign(privateKey);
}

export async function consumeCode(token: string): Promise<CodePayload> {
  const { publicKey } = loadEd25519Keypair();
  const { payload } = await jose.jwtVerify(token, publicKey, {
    audience: AUDIENCE,
    algorithms: ["EdDSA"],
  });
  if (typeof payload.jti === "string") {
    if (usedJtis.has(payload.jti)) {
      throw new Error("code already used");
    }
    usedJtis.add(payload.jti);
  }
  if (
    typeof payload.clientId !== "string" ||
    typeof payload.redirectUri !== "string" ||
    typeof payload.codeChallenge !== "string"
  ) {
    throw new Error("invalid code payload");
  }
  return {
    clientId: payload.clientId,
    redirectUri: payload.redirectUri,
    codeChallenge: payload.codeChallenge,
    scope: typeof payload.scope === "string" ? payload.scope : undefined,
  };
}
