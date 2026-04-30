/**
 * Auth for mcpist-vc — single-owner mode.
 *
 * No DB. The app has exactly one principal: the owner identified by
 * OWNER_EMAIL (hardcoded below). Two credential types are accepted:
 *
 *   1. Clerk session JWT (browser → Vercel) — verified via JWKS, then the
 *      Clerk profile is fetched once and the primary email is matched
 *      against OWNER_EMAIL. Anyone else: rejected.
 *   2. Bearer access token (MCP client → Vercel) — Ed25519 JWT minted by
 *      the OAuth /token endpoint. Audience-bound, expiry-checked. The
 *      mere fact that a valid signature exists is enough — it could only
 *      have been issued via /authorize, which itself required an owner
 *      Clerk session.
 *
 * In-memory caches per warm Lambda avoid re-hitting Clerk on every request.
 */

import * as jose from "jose";
import type { KeyObject } from "node:crypto";
import { loadEd25519Keypair } from "@/lib/ed25519";

export const OWNER_EMAIL = "shiba.dog.leo.private@gmail.com";

const ACCESS_TOKEN_AUDIENCE = "mcpist-oauth-access";

export interface AuthResult {
  authenticated: true;
  /** "clerk" for browser-issued, "oauth" for MCP-client-issued */
  source: "clerk" | "oauth";
}

const OWNER: AuthResult = { authenticated: true, source: "clerk" };
const OAUTH_OWNER: AuthResult = { authenticated: true, source: "oauth" };

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

// ── Caches ────────────────────────────────────────────────────────────────

const ownerByClerkIdCache = new Map<string, { allowed: boolean; expiresAt: number }>();
const OWNER_CACHE_TTL = 5 * 60 * 1000;

// ── Clerk path ────────────────────────────────────────────────────────────

interface ClerkUserResponse {
  email_addresses?: Array<{ id: string; email_address: string }>;
  primary_email_address_id?: string | null;
}

async function fetchOwnerEmail(clerkUserId: string): Promise<string | null> {
  const sk = process.env.CLERK_SECRET_KEY;
  if (!sk) return null;
  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
      headers: { Authorization: `Bearer ${sk}` },
    });
    if (!res.ok) return null;
    const u = (await res.json()) as ClerkUserResponse;
    if (!u.email_addresses || u.email_addresses.length === 0) return null;
    const primary = u.email_addresses.find(
      (e) => e.id === u.primary_email_address_id,
    );
    return primary?.email_address ?? u.email_addresses[0]?.email_address ?? null;
  } catch {
    return null;
  }
}

async function isClerkUserOwner(clerkUserId: string): Promise<boolean> {
  const cached = ownerByClerkIdCache.get(clerkUserId);
  if (cached && cached.expiresAt > Date.now()) return cached.allowed;
  const email = await fetchOwnerEmail(clerkUserId);
  const allowed = email?.toLowerCase() === OWNER_EMAIL.toLowerCase();
  ownerByClerkIdCache.set(clerkUserId, {
    allowed,
    expiresAt: Date.now() + OWNER_CACHE_TTL,
  });
  return allowed;
}

async function verifyClerkToken(token: string): Promise<AuthResult | null> {
  const jwks = getClerkJWKS();
  if (!jwks) return null;
  try {
    const { payload } = await jose.jwtVerify(token, jwks);
    const clerkUserId = payload.sub as string;
    if (!clerkUserId) return null;
    if (!(await isClerkUserOwner(clerkUserId))) return null;
    return OWNER;
  } catch {
    return null;
  }
}

// ── OAuth access-token path ───────────────────────────────────────────────

let accessTokenVerifier: KeyObject | null = null;

function getAccessTokenVerifier(): KeyObject | null {
  if (accessTokenVerifier) return accessTokenVerifier;
  try {
    accessTokenVerifier = loadEd25519Keypair().publicKey;
    return accessTokenVerifier;
  } catch (e) {
    console.error("[auth] failed to derive access-token verifier:", e);
    return null;
  }
}

async function verifyAccessToken(rawToken: string): Promise<AuthResult | null> {
  const verifier = getAccessTokenVerifier();
  if (!verifier) return null;
  try {
    await jose.jwtVerify(rawToken, verifier, {
      algorithms: ["EdDSA"],
      audience: ACCESS_TOKEN_AUDIENCE,
    });
    return OAUTH_OWNER;
  } catch {
    return null;
  }
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
  if (bearer) {
    // Try OAuth access token first (most common on /mcp), then Clerk JWT
    // (browser via Bearer header — uncommon but allowed).
    const r = await verifyAccessToken(bearer);
    if (r) return r;
    const c = await verifyClerkToken(bearer);
    if (c) return c;
  }
  const cookie = extractSessionCookie(req);
  if (cookie) {
    const r = await verifyClerkToken(cookie);
    if (r) return r;
  }
  return null;
}

/**
 * Convenience: did this Clerk session belong to the owner? Used by the
 * /oauth/authorize endpoint to gate consent without going through the
 * full bearer-or-cookie matrix.
 */
export async function authenticateClerkOwner(
  req: Request,
): Promise<AuthResult | null> {
  const cookie = extractSessionCookie(req);
  if (cookie) {
    const r = await verifyClerkToken(cookie);
    if (r) return r;
  }
  const bearer = extractBearerToken(req);
  if (bearer) {
    const r = await verifyClerkToken(bearer);
    if (r) return r;
  }
  return null;
}
