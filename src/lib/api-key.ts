/**
 * API key issuance.
 *
 * An mcpist API key is `mcpist_<EdDSA-JWT>` where the JWT carries:
 *   - alg: "EdDSA", kid: <random uuid> (also stored on the api_keys row)
 *   - sub: <mcpist user id>
 *   - exp: optional unix-seconds expiry
 *
 * The signer key is derived from SERVER_JWT_SIGNING_KEY via lib/ed25519,
 * which produces a Node KeyObject (Web Crypto's raw-import doesn't accept
 * Ed25519 *seeds* with sign usage — see ed25519.ts for the rationale).
 *
 * The full token string is returned ONLY at creation time (we don't store
 * it; we store the kid + a short visible prefix). Matches the legacy
 * Go server's contract.
 */

import * as jose from "jose";
import { loadEd25519Keypair } from "@/lib/ed25519";

const API_KEY_PREFIX = "mcpist_";

export interface IssuedApiKey {
  /** Full token to hand to the user — never returned again. */
  token: string;
  /** Stored on the api_keys row for `kid` lookup at verify time. */
  kid: string;
  /** First 14 chars of the token, surfaced in lists / logs. */
  keyPrefix: string;
}

/**
 * Issue a new API key JWT bound to `userId`. `expiresAt` is interpreted in
 * unix-seconds; pass `undefined` for no expiry.
 */
export async function issueApiKey(
  userId: string,
  expiresAt?: number,
): Promise<IssuedApiKey> {
  const kid = crypto.randomUUID();
  const { privateKey } = loadEd25519Keypair();

  const builder = new jose.SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "EdDSA", kid })
    .setSubject(userId)
    .setIssuedAt();

  if (expiresAt !== undefined) {
    builder.setExpirationTime(expiresAt);
  }

  const jwt = await builder.sign(privateKey);
  const token = `${API_KEY_PREFIX}${jwt}`;
  // 14 chars distinguishes keys in a list without leaking signing material;
  // the JWT header itself is ~36 chars and not secret.
  const keyPrefix = token.slice(0, 14);
  return { token, kid, keyPrefix };
}
