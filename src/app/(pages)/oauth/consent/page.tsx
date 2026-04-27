"use client";

/**
 * OAuth consent gateway.
 *
 * Lands here when /api/v1/oauth/authorize couldn't find a Clerk session.
 * AuthGate forces a Clerk login, then we navigate the browser back to
 * the authorize endpoint with the full original query string. The Clerk
 * cookie set during login means the second authorize request succeeds
 * silently — no extra UI for the user beyond Clerk's own login screen.
 *
 * Sits OUTSIDE the AppLayout (no sidebar) so it renders cleanly inside
 * the popup MCP clients open for the OAuth flow.
 */

import { useEffect } from "react";
import { AuthGate } from "@/components/auth/auth-gate";

function ConsentRedirect() {
  useEffect(() => {
    const search = window.location.search;
    // Full-page nav so the Clerk cookie is sent on the request that
    // follows; a `fetch` would 302 to claude.ai's redirect_uri and then
    // we'd have to follow it manually.
    window.location.href = `/api/v1/oauth/authorize${search}`;
  }, []);

  return (
    <div className="grid h-dvh place-items-center text-sm text-muted-foreground">
      Authorizing…
    </div>
  );
}

export default function OAuthConsentPage() {
  return (
    <AuthGate>
      <ConsentRedirect />
    </AuthGate>
  );
}
