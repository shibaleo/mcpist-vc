"use client";

/**
 * OAuth flow tester — popup callback page.
 *
 * Renders briefly while it relays the authorization code to the opener
 * window via postMessage, then closes itself. Lives outside AuthGate so
 * Clerk's redirect lands without requiring an mcpist session cookie.
 */

import { useEffect } from "react";

export default function OAuthTestCallbackPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const message = {
      type: "mcpist-oauth-test" as const,
      code: params.get("code"),
      state: params.get("state"),
      error: params.get("error"),
      errorDescription: params.get("error_description"),
    };
    if (window.opener) {
      window.opener.postMessage(message, window.location.origin);
      // Give the opener a tick to receive the message before closing.
      setTimeout(() => window.close(), 150);
    }
  }, []);

  return (
    <div className="grid h-dvh place-items-center text-sm text-muted-foreground">
      Returning to MCP Server tester…
    </div>
  );
}
