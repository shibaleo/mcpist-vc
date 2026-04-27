/**
 * Auth for mcpist-vc.
 *
 * Two credential types are accepted:
 *   1. Clerk session JWT (browser → Vercel) — verified via Clerk's JWKS,
 *      then mapped to a `mcpist.users` row by `clerk_id`. First-login
 *      auto-provision: if no row exists, we create one (with email +
 *      display name pulled from Clerk).
 *   2. API key JWT (MCP client → Vercel) — `mcpist_<EdDSA-JWT>` prefix.
 *      The JWT's `kid` matches a row in `mcpist.api_keys`, and the
 *      signature is verified against `SERVER_JWT_SIGNING_KEY` (Ed25519 seed).
 *
 * Both paths return the same `AuthResult` so route handlers don't need to
 * branch on credential type.
 *
 * In-memory caches (per warm Lambda) avoid hitting the DB on every request.
 */

import * as jose from "jose";
import { eq } from "drizzle-orm";
import type { KeyObject } from "node:crypto";
import { db } from "@/lib/db";
import { users, apiKeys } from "@/lib/db/schema";
import { loadEd25519Keypair } from "@/lib/ed25519";

export interface AuthResult {
  authenticated: true;
  userId: string;
  email: string | null;
  displayName: string | null;
  /** "clerk" for browser-issued, "apiKey" for MCP-client-issued */
  source: "clerk" | "apiKey";
}

const API_KEY_PREFIX = "mcpist_";

// ── Clerk JWKS ────────────────────────────────────────────────────────────

function getClerkDomain(): string | null {
  const pk = process.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (!pk) return null;
  const encoded = pk.replace(/^pk_(test|live)_/, "");
  try {
    return atob(encoded).replace(/\$$/, "");
  } catch {
    return null;
  }
}

let clerkJWKS: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
function getClerkJWKS() {
  if (clerkJWKS) return clerkJWKS;
  const domain = getClerkDomain();
  if (!domain) return null;
  clerkJWKS = jose.createRemoteJWKSet(
    new URL(`https://${domain}/.well-known/jwks.json`),
  );
  return clerkJWKS;
}

// ── In-memory caches ──────────────────────────────────────────────────────

const userByClerkIdCache = new Map<
  string,
  { result: AuthResult; expiresAt: number }
>();
const USER_CACHE_TTL = 5 * 60 * 1000;

const apiKeyCache = new Map<
  string,
  { result: AuthResult; expiresAt: number }
>();
const API_KEY_CACHE_TTL = 5 * 60 * 1000;

// ── Clerk path ────────────────────────────────────────────────────────────

interface ClerkUserResponse {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  email_addresses?: Array<{ id: string; email_address: string }>;
  primary_email_address_id?: string | null;
  image_url?: string | null;
}

async function fetchClerkUser(
  clerkUserId: string,
): Promise<ClerkUserResponse | null> {
  const sk = process.env.CLERK_SECRET_KEY;
  if (!sk) return null;
  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
      headers: { Authorization: `Bearer ${sk}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as ClerkUserResponse;
  } catch {
    return null;
  }
}

function deriveName(u: ClerkUserResponse): string | null {
  const parts = [u.first_name, u.last_name].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  if (parts.length > 0) return parts.join(" ");
  if (u.username) return u.username;
  return null;
}

function derivePrimaryEmail(u: ClerkUserResponse): string | null {
  if (!u.email_addresses || u.email_addresses.length === 0) return null;
  const primary = u.email_addresses.find(
    (e) => e.id === u.primary_email_address_id,
  );
  return primary?.email_address ?? u.email_addresses[0]?.email_address ?? null;
}

/**
 * Resolve a Clerk user ID to a mcpist user. Auto-provisions on first login.
 * Returned record uses the mcpist user's UUID, not the Clerk ID.
 */
async function resolveOrCreateUser(
  clerkUserId: string,
): Promise<AuthResult | null> {
  const cached = userByClerkIdCache.get(clerkUserId);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const existing = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(users)
    .where(eq(users.clerkId, clerkUserId))
    .limit(1);

  let result: AuthResult;
  if (existing.length > 0) {
    const row = existing[0];
    result = {
      authenticated: true,
      userId: row.id,
      email: row.email ?? null,
      displayName: row.displayName ?? null,
      source: "clerk",
    };
  } else {
    // First login — pull profile from Clerk and provision.
    const clerkUser = await fetchClerkUser(clerkUserId);
    const email = clerkUser ? derivePrimaryEmail(clerkUser) : null;
    const displayName = clerkUser ? deriveName(clerkUser) : null;

    const [inserted] = await db
      .insert(users)
      .values({
        clerkId: clerkUserId,
        email,
        displayName,
      })
      .returning({ id: users.id });
    result = {
      authenticated: true,
      userId: inserted.id,
      email,
      displayName,
      source: "clerk",
    };
  }

  userByClerkIdCache.set(clerkUserId, {
    result,
    expiresAt: Date.now() + USER_CACHE_TTL,
  });
  return result;
}

async function verifyClerkToken(token: string): Promise<AuthResult | null> {
  const jwks = getClerkJWKS();
  if (!jwks) {
    console.log("[auth] verifyClerk: no JWKS configured");
    return null;
  }
  try {
    const { payload, protectedHeader } = await jose.jwtVerify(token, jwks);
    const clerkUserId = payload.sub as string;
    if (!clerkUserId) {
      console.log("[auth] verifyClerk: no sub claim", { iss: payload.iss });
      return null;
    }
    return await resolveOrCreateUser(clerkUserId);
  } catch (e) {
    // Surface the verification failure reason (alg mismatch, expired, kid
    // not in JWKS, etc.) — lets us see why a Claude.ai-issued token is
    // being rejected without leaking the token itself.
    console.log("[auth] verifyClerk failed:", {
      reason: e instanceof Error ? e.message : String(e),
      tokenShape: `${token.slice(0, 16)}…(${token.length} chars)`,
    });
    return null;
  }
}

// ── API key path ──────────────────────────────────────────────────────────

let apiKeyVerifierKey: KeyObject | null = null;

function getApiKeyVerifier(): KeyObject | null {
  if (apiKeyVerifierKey) return apiKeyVerifierKey;
  try {
    apiKeyVerifierKey = loadEd25519Keypair().publicKey;
    return apiKeyVerifierKey;
  } catch (e) {
    console.error("[auth] failed to derive API key verifier:", e);
    return null;
  }
}

async function verifyApiKeyJwt(rawToken: string): Promise<AuthResult | null> {
  const cached = apiKeyCache.get(rawToken);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  if (!rawToken.startsWith(API_KEY_PREFIX)) return null;
  const jwt = rawToken.slice(API_KEY_PREFIX.length);

  const verifier = await getApiKeyVerifier();
  if (!verifier) return null;

  let payload: jose.JWTPayload;
  let header: jose.ProtectedHeaderParameters;
  try {
    const verified = await jose.jwtVerify(jwt, verifier, {
      algorithms: ["EdDSA"],
    });
    payload = verified.payload;
    header = verified.protectedHeader;
  } catch {
    return null;
  }

  const kid = header.kid;
  const sub = payload.sub;
  if (typeof kid !== "string" || typeof sub !== "string") return null;

  // Confirm the kid still maps to an active API key in the DB.
  const rows = await db
    .select({ id: apiKeys.id, userId: apiKeys.userId })
    .from(apiKeys)
    .where(eq(apiKeys.jwtKid, kid))
    .limit(1);
  if (rows.length === 0) return null;
  if (rows[0].userId !== sub) return null;

  const userRow = await db
    .select({ email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, sub))
    .limit(1);
  if (userRow.length === 0) return null;

  const result: AuthResult = {
    authenticated: true,
    userId: sub,
    email: userRow[0].email ?? null,
    displayName: userRow[0].displayName ?? null,
    source: "apiKey",
  };
  apiKeyCache.set(rawToken, {
    result,
    expiresAt: Date.now() + API_KEY_CACHE_TTL,
  });
  return result;
}

// ── Token extraction ──────────────────────────────────────────────────────

function extractBearerToken(req: Request): string | null {
  const header =
    req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
}

function extractSessionCookie(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)__session=([^;]*)/);
  return m ? m[1] : null;
}

// ── Public ────────────────────────────────────────────────────────────────

export async function authenticate(req: Request): Promise<AuthResult | null> {
  const bearer = extractBearerToken(req);
  const cookie = extractSessionCookie(req);

  for (const token of [bearer, cookie]) {
    if (!token) continue;
    if (token.startsWith(API_KEY_PREFIX)) {
      const r = await verifyApiKeyJwt(token);
      if (r) return r;
      continue;
    }
    const r = await verifyClerkToken(token);
    if (r) return r;
  }

  return null;
}
