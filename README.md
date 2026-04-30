# mcpist-vc

Single-owner MCP (Model Context Protocol) server with built-in OAuth.
Deployed on Vercel as a single Hono function + a Vite SPA console.

```
Claude.ai / Claude Desktop / Cursor
       ↓ Streamable HTTP, Bearer <Ed25519 JWT>
https://mcpist-vc.vercel.app/api/v1/mcp   ← MCP endpoint
       ↓
postgresql module (7 tools)
       ↓
PostgreSQL DB (MCPIST_DATABASE_URL)
```

Single-owner: no per-tenant DB, no user table, no credential storage.
The owner is identified by `OWNER_EMAIL` (hardcoded in
[src/lib/auth.ts](src/lib/auth.ts)); the postgres connection string is
read from `MCPIST_DATABASE_URL`.

## Architecture

| Layer | Tech |
|---|---|
| Frontend | Vite 8 + React 19 + TanStack Router + Clerk + shadcn/ui (dark) |
| Backend | Hono 4 |
| Vercel function | `api/index.ts` → `_bundle.mjs` (esbuild) → `src/server-entry.ts` adapter |
| Auth | Clerk JWT (browser, owner-only) + Ed25519 access-token JWT (MCP clients) |
| OAuth Authorization Server | Self-hosted: `/oauth/authorize`, `/oauth/token`, `/oauth/register` (DCR / RFC 7591). End-user login delegated to Clerk. Stateless — codes / refresh tokens / access tokens are all signed JWTs. |
| MCP transport | Streamable HTTP only (`POST /api/v1/mcp` JSON-RPC) |

## Layout

```
api/index.ts                     Vercel entry → re-exports _bundle.mjs
src/
  app/(pages)/                   UI pages
    mcp-server/                  endpoint URL + verifier
    oauth/consent/               OAuth authorize → Clerk login bounce
    dev/oauth-tester/            full handshake walker (debugging)
  components/                    shadcn/ui primitives + AuthGate + AppLayout
  lib/
    auth.ts                      Clerk JWT (owner gate) + access-token verification
    ed25519.ts                   PKCS#8 keypair from SERVER_JWT_SIGNING_KEY
    app-url.ts                   Canonical app URL resolution
    mcp/                         Module registry, JSON-RPC dispatcher,
                                 Streamable HTTP transport
    oauth-server/                Authorization-code + refresh-token + access-token JWTs
    hono-app.ts                  Route mounting + auth gate + CORS
  routes/
    mcp.ts                       POST /api/v1/mcp
    well-known.ts                .well-known/oauth-{protected-resource,authorization-server}
    oauth-{authorize,token,register}.ts
    health.ts                    GET /health (env probe)
scripts/
  build-api.mjs                  esbuild → api/_bundle.mjs
```

## Env

| Var | Purpose |
|---|---|
| `SERVER_JWT_SIGNING_KEY` | 32-byte base64 Ed25519 seed — signs OAuth codes, refresh + access tokens. Rotate to invalidate every issued token. |
| `MCPIST_DATABASE_URL` | Postgres URL for the postgresql MCP module. |
| `VITE_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | Clerk |
| `APP_URL` | Optional. Falls back to `VERCEL_PROJECT_PRODUCTION_URL` then to the request host. |

No DB, no encryption key — single-owner mode means all secrets are env vars.

## Adding an MCP module

1. New folder under `src/lib/mcp/modules/<name>/`
2. `schemas.json` — tool definitions (id, name, descriptions, annotations, inputSchema)
3. `tools.ts` — handlers with signature `(params) => Promise<string>`
4. `index.ts` — wraps schemas + handlers, calls `registerModule(...)`
5. `import "@/lib/mcp/modules/<name>"` in [src/routes/mcp.ts](src/routes/mcp.ts)

The `postgresql` module is the working reference.

## Local dev

```sh
pnpm install
pnpm dev                   # Vite dev server on :5173
pnpm build                 # vite build && esbuild bundle for Vercel
```

## OAuth flow (Claude.ai etc.)

mcpist is a self-hosted OAuth 2.0 Authorization Server. Discovery →
DCR → PKCE-authorize → token exchange. Authorize verifies the Clerk
session cookie (or bounces through `/oauth/consent` for login) and
checks the email matches `OWNER_EMAIL`, then issues a 5-min auth code.
Token endpoint returns:

```json
{
  "access_token":  "eyJ...",   // 24h, used as Bearer for /api/v1/mcp
  "refresh_token": "eyJ...",   // 90d, swap for new access_token
  "token_type":    "Bearer",
  "expires_in":    86400
}
```

Verify the round-trip end-to-end on the
[`/dev/oauth-tester`](https://mcpist-vc.vercel.app/dev/oauth-tester) page.

## Deploy

GitHub-pushed → Vercel auto-deploys. Project settings: framework = Vite,
region = `sfo1`.
