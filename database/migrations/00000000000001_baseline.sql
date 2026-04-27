-- =============================================================================
-- mcpist-vc baseline schema
-- =============================================================================
-- Slim design for the single-user, no-Stripe, no-prompts deployment.
-- Re-runnable: drops the schema first so a fresh bootstrap is idempotent.
-- =============================================================================

DROP SCHEMA IF EXISTS mcpist CASCADE;
CREATE SCHEMA mcpist;

-- ── Users ───────────────────────────────────────────────────────────────────
-- Local-id ↔ Clerk-id mapping. Identity is owned by Clerk; we cache email
-- and display_name so /me responds without a Clerk API round-trip.
CREATE TABLE mcpist.users (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clerk_id     TEXT NOT NULL UNIQUE,
    email        TEXT,
    display_name TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── API keys ────────────────────────────────────────────────────────────────
-- MCP-client tokens. Verification: Ed25519 JWT, kid → row lookup.
-- key_prefix is the first ~14 chars of the issued token, surfaced in lists.
CREATE TABLE mcpist.api_keys (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES mcpist.users(id) ON DELETE CASCADE,
    jwt_kid      TEXT NOT NULL UNIQUE,
    key_prefix   TEXT NOT NULL,
    name         TEXT NOT NULL,
    expires_at   TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_user_id_idx ON mcpist.api_keys(user_id);

-- ── User credentials ───────────────────────────────────────────────────────
-- Per-(user, module) connection strings / OAuth tokens, AES-256-GCM encrypted.
-- `module` is free text — the in-process MCP module registry is the source
-- of truth, no FK to a modules table.
CREATE TABLE mcpist.user_credentials (
    user_id    UUID NOT NULL REFERENCES mcpist.users(id) ON DELETE CASCADE,
    module     TEXT NOT NULL,
    encrypted  TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, module)
);

-- ── Tool settings ──────────────────────────────────────────────────────────
-- Per-(user, tool) on/off. tool_id format: "<module>:<tool>" (e.g. "postgresql:query").
-- Absence = default (the dispatcher picks: ReadOnly tools default-on,
-- destructive tools default-off).
CREATE TABLE mcpist.tool_settings (
    user_id    UUID NOT NULL REFERENCES mcpist.users(id) ON DELETE CASCADE,
    tool_id    TEXT NOT NULL,
    enabled    BOOLEAN NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, tool_id)
);

-- ── OAuth apps (admin-managed) ─────────────────────────────────────────────
-- Per-provider OAuth client credentials. Read by the OAuth start/callback
-- flow; populated through the admin UI. client_secret is AES-256-GCM
-- encrypted using the same key as user_credentials.
CREATE TABLE mcpist.oauth_apps (
    provider                TEXT PRIMARY KEY,
    client_id               TEXT NOT NULL,
    encrypted_client_secret TEXT NOT NULL,
    redirect_uri            TEXT,
    enabled                 BOOLEAN NOT NULL DEFAULT true,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

