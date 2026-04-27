/**
 * Canonical app URL resolution.
 *
 * The OAuth flow's redirect_uri is registered ONCE with each provider's
 * developer console — the value we send at authorize/token time has to
 * match byte-for-byte. Deriving it from `Host`/`x-forwarded-host` would
 * break the moment a request hits a deployment-specific Vercel URL
 * (`mcpist-abc123-shibaleos-projects.vercel.app`) instead of the canonical
 * alias (`mcpist-vc.vercel.app`).
 *
 * Resolution order:
 *   1. APP_URL env (explicit override)
 *   2. VERCEL_PROJECT_PRODUCTION_URL — auto-injected by Vercel; always the
 *      canonical production hostname even on preview-URL hits.
 *   3. Request-derived URL — fallback for `vercel dev` / `pnpm dev` /
 *      self-hosted setups where neither env is set.
 */

function ensureScheme(host: string): string {
  if (host.startsWith("http://") || host.startsWith("https://")) {
    return host.replace(/\/+$/, "");
  }
  return `https://${host.replace(/\/+$/, "")}`;
}

export function getAppUrl(req: Request): string {
  const explicit = process.env.APP_URL;
  if (explicit) return ensureScheme(explicit);

  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProd) return ensureScheme(vercelProd);

  // Local dev: use whatever host the request came in on.
  const url = new URL(req.url);
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (url.protocol === "https:" ? "https" : "http");
  return `${proto}://${host}`;
}

export function getOAuthCallbackUrl(req: Request): string {
  return `${getAppUrl(req)}/api/v1/oauth/callback`;
}
