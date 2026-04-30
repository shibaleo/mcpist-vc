/**
 * OAuth access tokens.
 *
 * 24-hour Ed25519 JWTs handed back from /oauth/token as the Bearer token.
 * The MCP `/mcp` endpoint verifies them via lib/auth.verifyAccessToken.
 *
 * Audience-bound to "mcpist-oauth-access" so a refresh-token JWT or
 * authorization-code JWT can never be accepted in its place.
 */

import * as jose from "jose";
import { loadEd25519Keypair } from "@/lib/ed25519";

const TTL_S = 24 * 60 * 60;
const AUDIENCE = "mcpist-oauth-access";

export interface AccessTokenInfo {
  token: string;
  expiresInSeconds: number;
}

export async function issueAccessToken(
  clientId: string,
  scope: string | undefined,
): Promise<AccessTokenInfo> {
  const { privateKey } = loadEd25519Keypair();
  const builder = new jose.SignJWT({ clientId, scope })
    .setProtectedHeader({ alg: "EdDSA" })
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setAudience(AUDIENCE)
    .setExpirationTime(Math.floor(Date.now() / 1000) + TTL_S);
  const token = await builder.sign(privateKey);
  return { token, expiresInSeconds: TTL_S };
}

export const ACCESS_TOKEN_TTL_S = TTL_S;
