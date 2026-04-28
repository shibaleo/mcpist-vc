# mcpist-vc

Single-user MCP (Model Context Protocol) server with built-in OAuth.
Deployed on Vercel as a single Hono function + a Vite SPA console.

```
Claude.ai / Claude Desktop / Cursor
       ↓ Streamable HTTP, Bearer mcpist_<JWT>
https://mcpist-vc.vercel.app/api/v1/mcp   ← MCP endpoint
       ↓
postgresql module (7 tools)               ← Phase 4 only module so far
       ↓
arbitrary user PostgreSQL DB              ← per-user credential
```

## Architecture

| Layer | Tech |
|---|---|
| Frontend | Vite 8 + React 19 + TanStack Router + Clerk + shadcn/ui (dark) |
| Backend | Hono 4 + Drizzle ORM + Neon (HTTP) |
| Vercel function | `api/index.ts` → `_bundle.mjs` (esbuild) → `src/server-entry.ts` adapter (IncomingMessage → fetch Request → `app.fetch`) |
| Auth | Clerk JWT (browser) + Ed25519 API-key JWT (MCP clients) |
| OAuth Authorization Server | Self-hosted: `/oauth/authorize`, `/oauth/token`, `/oauth/register` (DCR / RFC 7591). End-user login delegated to Clerk. |
| MCP transport | Streamable HTTP only (`POST /api/v1/mcp` JSON-RPC) |
| Credentials at rest | AES-256-GCM, single key in `CREDENTIAL_ENCRYPTION_KEY` |

## Layout

```
api/index.ts                     Vercel entry → re-exports _bundle.mjs
src/
  app/(pages)/                   UI pages
    mcp-server/                  endpoint URL + verifier + OAuth flow tester
    modules/                     per-tool ON/OFF (Tools page)
    credentials/                 per-module connection mgmt (Services page)
    api-keys/                    issue / revoke MCP API keys
    oauth-apps/                  admin: OAuth app registry
    oauth/consent/               OAuth authorize → Clerk login bounce
    oauth-test/callback/         OAuth flow tester popup callback
  components/                    shadcn/ui primitives + AuthGate + AppLayout
  hooks/queries/                 TanStack Query hooks (typed via Hono RPC)
  lib/
    auth.ts                      Clerk JWT + API-key verification
    api-key.ts                   API-key issuance (Ed25519)
    ed25519.ts                   PKCS#8 keypair from SERVER_JWT_SIGNING_KEY
    app-url.ts                   Canonical app URL resolution
    credentials/                 AES-256-GCM + per-(user, module) broker
    db/                          Drizzle schema + Neon HTTP client
    mcp/                         Module registry, JSON-RPC dispatcher,
                                 Streamable HTTP transport
    oauth-server/                Authorization-code + refresh-token JWTs
    hono-app.ts                  Route mounting + auth gate + CORS
    rpc-client.ts                hc<AppType>() — type-safe RPC for the SPA
  routes/
    mcp.ts                       POST /api/v1/mcp
    well-known.ts                .well-known/oauth-{protected-resource,authorization-server}
    oauth-{authorize,token,register}.ts
    me/                          /me/{credentials,api-keys,modules,oauth}
    admin/oauth-apps.ts          OAuth client management
    health.ts                    /health + /health/diag (DB probe)
database/migrations/             Hand-written SQL baseline
scripts/
  bootstrap-db.mjs               Apply baseline.sql to whatever DATABASE_URL
  drop-schema.mjs                DROP SCHEMA mcpist CASCADE (gated by env)
  build-api.mjs                  esbuild → api/_bundle.mjs
```

## Env

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Neon HTTP-driver URL |
| `CREDENTIAL_ENCRYPTION_KEY` | 32-byte base64 — AES-256-GCM key for `user_credentials.encrypted` |
| `SERVER_JWT_SIGNING_KEY` | 32-byte base64 Ed25519 seed — signs API keys, OAuth codes, refresh tokens |
| `VITE_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | Clerk |
| `APP_URL` | Optional. Falls back to `VERCEL_PROJECT_PRODUCTION_URL` then to the request host. |

## DB schema (slim, 5 tables)

```
users               id, clerk_id, email, display_name, timestamps
api_keys            id, user_id, jwt_kid, key_prefix, name, expires_at, last_used_at
user_credentials    user_id+module (PK), encrypted, timestamps
tool_settings       user_id+tool_id (PK), enabled, updated_at
oauth_apps          provider (PK), client_id, encrypted_client_secret,
                    redirect_uri, enabled, timestamps
```

Bootstrap a fresh Neon DB with `pnpm db:bootstrap`.

## Adding an MCP module

1. New folder under `src/lib/mcp/modules/<name>/`
2. `schemas.json` — tool definitions (id, name, descriptions, annotations, inputSchema)
3. `tools.ts` — handlers with signature `(ctx: ModuleContext, params) => Promise<string>`
4. `index.ts` — wraps schemas + handlers, calls `registerModule(...)`
5. `import "@/lib/mcp/modules/<name>"` in [src/routes/mcp.ts](src/routes/mcp.ts)

The `postgresql` module is the working reference.

## Local dev

```sh
pnpm install
pnpm db:bootstrap          # apply baseline.sql to DATABASE_URL
pnpm dev                   # Vite dev server + Hono SSR plugin on :5173
pnpm build                 # vite build && esbuild bundle for Vercel
```

## OAuth flow (Claude.ai etc.)

mcpist is a self-hosted OAuth 2.0 Authorization Server. Discovery →
DCR → PKCE-authorize → token exchange. Authorize verifies the Clerk
session cookie (or bounces through `/oauth/consent` for login), then
issues a 5-min auth code. Token endpoint returns:

```json
{
  "access_token":  "mcpist_eyJ...",   // 24h, used as Bearer for /api/v1/mcp
  "refresh_token": "eyJ...",          // 90d, swap for new access_token
  "token_type":    "Bearer",
  "expires_in":    86400
}
```

Verify the round-trip end-to-end on the [`/mcp-server`](https://mcpist-vc.vercel.app/mcp-server) page's "OAuth flow test" card.

## Deploy

GitHub-pushed → Vercel auto-deploys. Project settings: framework = Vite,
region = `sfo1` (close to the Neon DB).
