/**
 * OAuth provider catalog + credential lookup.
 *
 * Provider catalog is hardcoded (the 11 services the legacy mcpist
 * supported). Credentials (client_id / client_secret) are looked up:
 *
 *   1. `mcpist.oauth_apps` row keyed by provider — managed via
 *      /api/v1/admin/oauth-apps. client_secret is AES-GCM encrypted.
 *   2. fallback: `<PROVIDER>_CLIENT_ID` / `<PROVIDER>_CLIENT_SECRET`
 *      env vars. Convenient for local dev without touching the DB.
 *
 * The DB path takes precedence so an admin-set value overrides any env.
 *
 * `listConfiguredProviders()` returns providers reachable through either
 * path — the OAuth UI uses this to surface available connect buttons.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { oauthApps } from "@/lib/db/schema";
import { decrypt } from "@/lib/credentials/crypto";

export interface OAuthProvider {
  /** Stable id, matches `mcpist.oauth_apps.provider` and the env-var prefix. */
  id: string;
  /** Display name for the UI. */
  name: string;
  /** One-liner shown next to the name. */
  description: string;
  authorizeUrl: string;
  tokenUrl: string;
  /** Default scopes if a per-module override isn't set. Space-separated. */
  defaultScopes: string;
  tokenAuthMethod: "form" | "basic";
  tokenContentType: "urlencoded" | "json";
  rotatesRefreshToken: boolean;
  extraAuthorizeParams?: Record<string, string>;
  extraTokenParams?: Record<string, string>;
  /** Provider's developer console URL — surfaced in the admin dialog. */
  docsUrl: string;
}

export const PROVIDER_CATALOG: OAuthProvider[] = [
  {
    id: "notion",
    name: "Notion",
    description: "Notion pages, databases, blocks",
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    defaultScopes: "",
    tokenAuthMethod: "basic",
    tokenContentType: "json",
    rotatesRefreshToken: true,
    extraAuthorizeParams: { owner: "user" },
    docsUrl: "https://www.notion.so/profile/integrations",
  },
  {
    id: "github",
    name: "GitHub",
    description: "Repos, issues, PRs",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    defaultScopes: "repo read:user",
    tokenAuthMethod: "form",
    tokenContentType: "urlencoded",
    rotatesRefreshToken: false,
    docsUrl: "https://github.com/settings/developers",
  },
  {
    id: "google",
    name: "Google",
    description: "Drive, Calendar, Docs, Sheets, Tasks",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    defaultScopes:
      "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/calendar",
    tokenAuthMethod: "form",
    tokenContentType: "urlencoded",
    rotatesRefreshToken: false,
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
    docsUrl: "https://console.cloud.google.com/apis/credentials",
  },
  {
    id: "atlassian",
    name: "Atlassian",
    description: "Jira, Confluence",
    authorizeUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    defaultScopes:
      "read:jira-work write:jira-work read:jira-user offline_access",
    tokenAuthMethod: "form",
    tokenContentType: "urlencoded",
    rotatesRefreshToken: true,
    extraAuthorizeParams: { audience: "api.atlassian.com", prompt: "consent" },
    docsUrl: "https://developer.atlassian.com/console/myapps/",
  },
  {
    id: "microsoft",
    name: "Microsoft",
    description: "Microsoft To Do, Outlook, OneDrive",
    authorizeUrl:
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    defaultScopes: "offline_access Tasks.ReadWrite",
    tokenAuthMethod: "form",
    tokenContentType: "urlencoded",
    rotatesRefreshToken: true,
    docsUrl: "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps",
  },
  {
    id: "asana",
    name: "Asana",
    description: "Workspaces, projects, tasks",
    authorizeUrl: "https://app.asana.com/-/oauth_authorize",
    tokenUrl: "https://app.asana.com/-/oauth_token",
    defaultScopes: "",
    tokenAuthMethod: "form",
    tokenContentType: "urlencoded",
    rotatesRefreshToken: true,
    docsUrl: "https://app.asana.com/0/developer-console",
  },
  {
    id: "todoist",
    name: "Todoist",
    description: "Tasks, projects, labels",
    authorizeUrl: "https://todoist.com/oauth/authorize",
    tokenUrl: "https://todoist.com/oauth/access_token",
    defaultScopes: "data:read_write,data:delete",
    tokenAuthMethod: "form",
    tokenContentType: "urlencoded",
    rotatesRefreshToken: false,
    docsUrl: "https://developer.todoist.com/appconsole.html",
  },
  {
    id: "ticktick",
    name: "TickTick",
    description: "TickTick tasks",
    authorizeUrl: "https://ticktick.com/oauth/authorize",
    tokenUrl: "https://ticktick.com/oauth/token",
    defaultScopes: "tasks:read tasks:write",
    tokenAuthMethod: "basic",
    tokenContentType: "urlencoded",
    rotatesRefreshToken: false,
    docsUrl: "https://developer.ticktick.com/",
  },
  {
    id: "trello",
    name: "Trello",
    description: "Boards, cards, checklists",
    authorizeUrl: "https://trello.com/1/authorize",
    // Trello uses OAuth 1.0a — token exchange isn't a plain POST. The OAuth
    // flow currently bails for empty tokenUrl; full Trello support is a
    // future task.
    tokenUrl: "",
    defaultScopes: "read,write",
    tokenAuthMethod: "form",
    tokenContentType: "urlencoded",
    rotatesRefreshToken: false,
    docsUrl: "https://trello.com/power-ups/admin",
  },
  {
    id: "airtable",
    name: "Airtable",
    description: "Bases, tables, records",
    authorizeUrl: "https://airtable.com/oauth2/v1/authorize",
    tokenUrl: "https://airtable.com/oauth2/v1/token",
    defaultScopes:
      "data.records:read data.records:write schema.bases:read schema.bases:write",
    tokenAuthMethod: "basic",
    tokenContentType: "urlencoded",
    rotatesRefreshToken: true,
    docsUrl: "https://airtable.com/create/oauth",
  },
  {
    id: "dropbox",
    name: "Dropbox",
    description: "Files, folders, sharing",
    authorizeUrl: "https://www.dropbox.com/oauth2/authorize",
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
    defaultScopes:
      "files.metadata.read files.metadata.write files.content.read files.content.write",
    tokenAuthMethod: "form",
    tokenContentType: "urlencoded",
    rotatesRefreshToken: false,
    extraAuthorizeParams: { token_access_type: "offline" },
    docsUrl: "https://www.dropbox.com/developers/apps",
  },
];

export function getProvider(id: string): OAuthProvider | null {
  return PROVIDER_CATALOG.find((p) => p.id === id) ?? null;
}

/**
 * Map a module name to its OAuth provider. Most modules share their name
 * with the provider (notion → notion); multi-module providers (Google →
 * google_drive, google_calendar, ...) need an explicit override.
 */
export function moduleProvider(module: string): string {
  const overrides: Record<string, string> = {
    google_drive: "google",
    google_calendar: "google",
    google_docs: "google",
    google_sheets: "google",
    google_apps_script: "google",
    google_tasks: "google",
    jira: "atlassian",
    confluence: "atlassian",
    microsoft_todo: "microsoft",
  };
  return overrides[module] ?? module;
}

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
  /** Per-app redirect URI override, if the admin set one explicitly. */
  redirectUri?: string;
}

/**
 * Look up usable credentials for `provider`. Returns null if neither the DB
 * row nor the env fallback yields a complete (id, secret) pair.
 *
 * Cache invalidation: we re-query the DB on every authorize/callback because
 * Vercel function invocations are short-lived and the rows are tiny — a
 * 5-min stale window would surprise admins right after a credential rotation.
 */
export async function getProviderCredentials(
  provider: OAuthProvider,
): Promise<ProviderCredentials | null> {
  const rows = await db
    .select({
      clientId: oauthApps.clientId,
      encryptedSecret: oauthApps.encryptedClientSecret,
      redirectUri: oauthApps.redirectUri,
      enabled: oauthApps.enabled,
    })
    .from(oauthApps)
    .where(eq(oauthApps.provider, provider.id))
    .limit(1);

  if (rows.length > 0 && rows[0].enabled && rows[0].encryptedSecret) {
    try {
      const clientSecret = await decrypt(rows[0].encryptedSecret);
      return {
        clientId: rows[0].clientId,
        clientSecret,
        redirectUri: rows[0].redirectUri ?? undefined,
      };
    } catch (e) {
      console.error(
        `[oauth] failed to decrypt client_secret for ${provider.id}:`,
        e,
      );
    }
  }

  // Env fallback — useful when admins haven't registered the provider in the
  // DB yet. Pattern is `<UPPER_ID>_CLIENT_ID` / `<UPPER_ID>_CLIENT_SECRET`.
  const envPrefix = provider.id.toUpperCase();
  const clientId = process.env[`${envPrefix}_CLIENT_ID`];
  const clientSecret = process.env[`${envPrefix}_CLIENT_SECRET`];
  if (clientId && clientSecret) {
    return { clientId, clientSecret };
  }

  return null;
}

/** Providers with a usable credential source (DB or env). */
export async function listConfiguredProviders(): Promise<
  Array<{ provider: string; name: string; source: "db" | "env" }>
> {
  const dbRows = await db
    .select({
      provider: oauthApps.provider,
      hasSecret: oauthApps.encryptedClientSecret,
      enabled: oauthApps.enabled,
    })
    .from(oauthApps);
  const dbConfigured = new Set<string>();
  for (const row of dbRows) {
    if (row.enabled && row.hasSecret) dbConfigured.add(row.provider);
  }

  const result: Array<{
    provider: string;
    name: string;
    source: "db" | "env";
  }> = [];
  for (const p of PROVIDER_CATALOG) {
    if (dbConfigured.has(p.id)) {
      result.push({ provider: p.id, name: p.name, source: "db" });
      continue;
    }
    const envPrefix = p.id.toUpperCase();
    if (
      process.env[`${envPrefix}_CLIENT_ID`] &&
      process.env[`${envPrefix}_CLIENT_SECRET`]
    ) {
      result.push({ provider: p.id, name: p.name, source: "env" });
    }
  }
  return result;
}
