/**
 * /api/v1/oauth/callback — public endpoint that providers redirect back to
 * after the user authorises. Public because the request comes from the
 * provider (or via the user's browser following a 302 from there) and
 * carries no Clerk session — the userId lives inside the signed `state`
 * JWT we emitted at /me/oauth/start.
 *
 * On success: redirects the browser to the in-app `redirect` we encoded
 * into state, with `?oauth=connected&module=<name>` appended.
 * On failure: redirects to the same target with `?oauth=error&message=...`.
 */

import { Hono } from "hono";
import { completeCallback } from "@/lib/oauth/flow";

function appendQuery(path: string, params: Record<string, string>): string {
  // path is in-app and starts with `/`. We rebuild against a dummy origin
  // so URL takes care of merging existing query strings cleanly, then
  // strip the origin back off.
  const u = new URL(path.startsWith("/") ? path : `/${path}`, "http://x");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return `${u.pathname}${u.search}${u.hash}`;
}

const app = new Hono().get("/", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");
  const errorDescription = c.req.query("error_description");

  if (error) {
    const target = appendQuery("/credentials", {
      oauth: "error",
      message: errorDescription ?? error,
    });
    return c.redirect(target);
  }

  if (!code || !state) {
    return c.redirect(
      appendQuery("/credentials", {
        oauth: "error",
        message: "missing code or state",
      }),
    );
  }

  // Reconstruct the same callback URL we used at /start time so the token
  // exchange's `redirect_uri` matches what the provider verified.
  const url = new URL(c.req.url);
  const host =
    c.req.header("x-forwarded-host") ?? c.req.header("host") ?? url.host;
  const proto =
    c.req.header("x-forwarded-proto") ??
    (url.protocol === "https:" ? "https" : "http");
  const callbackUrl = `${proto}://${host}/api/v1/oauth/callback`;

  try {
    const { module, redirect } = await completeCallback({
      code,
      state,
      callbackUrl,
    });
    return c.redirect(
      appendQuery(redirect, { oauth: "connected", module }),
    );
  } catch (e) {
    console.error("[oauth] callback failed:", e);
    return c.redirect(
      appendQuery("/credentials", {
        oauth: "error",
        message: e instanceof Error ? e.message : String(e),
      }),
    );
  }
});

export default app;
