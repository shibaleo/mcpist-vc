"use client";

import { usePageTitle } from "@/lib/page-context";
import { OAuthTester } from "./tester";

export default function OAuthTesterPage() {
  usePageTitle("OAuth tester");
  // Compute the MCP endpoint client-side so the test always targets the
  // same origin the user is browsing — no env round-trip needed.
  const endpoint =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/api/v1/mcp`;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">OAuth flow tester</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Dev-only utility. Walks the full MCP-OAuth handshake an external
          client (Claude.ai, Claude Desktop, ...) does so failures can be
          attributed to a specific step.
        </p>
      </div>
      <OAuthTester mcpEndpoint={endpoint} />
    </div>
  );
}
