/**
 * Credential broker — read decrypted credentials per (user, module).
 *
 * Mirrors the legacy Go `broker.GetTokenBroker().GetModuleToken(...)`.
 * OAuth refresh is intentionally out of scope for Phase 2; modules that
 * need a fresh access token will call the broker, get the stored value,
 * and (for OAuth providers) the broker can be extended in Phase 5/9 to
 * refresh transparently. PG and other static-credential modules don't need
 * refresh at all.
 */

import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { userCredentials } from "@/lib/db/schema";
import { decrypt, encrypt } from "./crypto";

export interface Credentials {
  authType?: string;

  // OAuth 2.0
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;

  // OAuth 1.0a
  consumerKey?: string;
  consumerSecret?: string;
  accessTokenSecret?: string;

  // API key
  apiKey?: string;

  // Basic
  username?: string;
  password?: string;

  // Custom header
  token?: string;
  headerName?: string;

  metadata?: Record<string, unknown>;
}

/**
 * The legacy Go broker reads JSON-encoded credentials with snake_case keys
 * (`access_token`, `refresh_token`, ...). We accept both and normalise.
 */
function normalize(raw: unknown): Credentials {
  if (typeof raw !== "object" || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) if (r[k] !== undefined) return r[k];
    return undefined;
  };
  const expiresAtRaw = pick("expires_at", "expiresAt");
  let expiresAt: number | undefined;
  if (typeof expiresAtRaw === "number") {
    expiresAt = expiresAtRaw;
  } else if (typeof expiresAtRaw === "string" && expiresAtRaw !== "") {
    const t = Date.parse(expiresAtRaw);
    expiresAt = Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
  }

  const str = (v: unknown): string | undefined =>
    typeof v === "string" ? v : undefined;

  return {
    authType: str(pick("auth_type", "authType")),
    accessToken: str(pick("access_token", "accessToken")),
    refreshToken: str(pick("refresh_token", "refreshToken")),
    expiresAt,
    consumerKey: str(pick("consumer_key", "consumerKey")),
    consumerSecret: str(pick("consumer_secret", "consumerSecret")),
    accessTokenSecret: str(pick("access_token_secret", "accessTokenSecret")),
    apiKey: str(pick("api_key", "apiKey")),
    username: str(pick("username")),
    password: str(pick("password")),
    token: str(pick("token")),
    headerName: str(pick("header_name", "headerName")),
    metadata:
      typeof r.metadata === "object" && r.metadata !== null
        ? (r.metadata as Record<string, unknown>)
        : undefined,
  };
}

export async function getModuleCredentials(
  userId: string,
  module: string,
): Promise<Credentials | null> {
  const rows = await db
    .select({ blob: userCredentials.encrypted })
    .from(userCredentials)
    .where(
      and(eq(userCredentials.userId, userId), eq(userCredentials.module, module)),
    )
    .limit(1);
  if (rows.length === 0) return null;
  const plain = await decrypt(rows[0].blob);
  let parsed: unknown;
  try {
    parsed = JSON.parse(plain);
  } catch {
    // Some legacy modules stored a raw string (e.g., a plain connection
    // string). Surface it as accessToken so callers can still use it.
    return { accessToken: plain };
  }
  return normalize(parsed);
}

export async function upsertModuleCredentials(
  userId: string,
  module: string,
  credentials: Credentials,
): Promise<void> {
  const enc = await encrypt(JSON.stringify(credentials));
  await db
    .insert(userCredentials)
    .values({
      userId,
      module,
      encrypted: enc,
    })
    .onConflictDoUpdate({
      target: [userCredentials.userId, userCredentials.module],
      set: { encrypted: enc, updatedAt: new Date() },
    });
}

export async function deleteModuleCredentials(
  userId: string,
  module: string,
): Promise<void> {
  await db
    .delete(userCredentials)
    .where(
      and(eq(userCredentials.userId, userId), eq(userCredentials.module, module)),
    );
}
