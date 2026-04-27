"use client";

/**
 * OAuth flow tester.
 *
 * Walks the same MCP-OAuth dance an external client (Claude.ai, etc.)
 * goes through:
 *
 *   1. POST initialize → expect 401 + WWW-Authenticate header
 *   2. Fetch protected-resource metadata
 *   3. Fetch authorization-server metadata
 *   4. Dynamic Client Registration (RFC 7591)
 *   5. PKCE challenge generation
 *   6. Authorize popup → user logs in via Clerk
 *   7. Token exchange (code + verifier → access_token)
 *   8. POST initialize again with Bearer token
 *
 * Steps render progressively with status; failures stop the chain. Pure
 * dev/debug tool — no server-side state.
 */

import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Play,
  XCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PROTOCOL_VERSION = "2025-03-26";

type StepStatus = "pending" | "running" | "success" | "error";

interface Step {
  name: string;
  status: StepStatus;
  message?: string;
  responseJson?: unknown;
}

interface CallbackMessage {
  type: "mcpist-oauth-test";
  code: string | null;
  state: string | null;
  error: string | null;
  errorDescription: string | null;
}

// ── PKCE helpers ─────────────────────────────────────────────────────────

function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomBase64Url(len: number): string {
  const buf = new Uint8Array(new ArrayBuffer(len));
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

// ── Component ────────────────────────────────────────────────────────────

export function OAuthTester({ mcpEndpoint }: { mcpEndpoint: string }) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const append = (s: Step) =>
    setSteps((prev) => {
      const next = [...prev, s];
      return next;
    });
  const update = (idx: number, patch: Partial<Step>) =>
    setSteps((prev) => prev.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  const toggle = (i: number) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  const fail = (idx: number, msg: string) => {
    update(idx, { status: "error", message: msg });
    setRunning(false);
  };

  const run = async () => {
    setSteps([]);
    setExpanded(new Set());
    setAccessToken(null);
    setRunning(true);

    // 1) Probe MCP endpoint for 401 + WWW-Authenticate
    append({ name: "probe MCP /initialize", status: "running" });
    let probeRes: Response;
    try {
      probeRes = await fetch(mcpEndpoint, {
        method: "POST",
        // Suppress the Clerk session cookie — otherwise the auth gate
        // would accept the existing browser session and return 200,
        // bypassing the OAuth flow we're trying to test.
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "mcpist OAuth tester", version: "1.0" },
          },
        }),
      });
    } catch (e) {
      return fail(0, e instanceof Error ? e.message : String(e));
    }
    if (probeRes.status !== 401) {
      return fail(0, `expected 401, got ${probeRes.status}`);
    }
    const wwwAuth = probeRes.headers.get("WWW-Authenticate");
    if (!wwwAuth) {
      return fail(
        0,
        "no WWW-Authenticate header (CORS exposeHeaders missing?)",
      );
    }
    const m = wwwAuth.match(/resource_metadata="([^"]+)"/);
    if (!m) return fail(0, "no resource_metadata in WWW-Authenticate");
    const resourceMetadataUrl = m[1];
    update(0, {
      status: "success",
      message: `WWW-Authenticate → ${new URL(resourceMetadataUrl).pathname}`,
    });

    // 2) Fetch resource metadata
    append({ name: "fetch resource_metadata", status: "running" });
    let rm: { authorization_servers: string[] };
    try {
      const r = await fetch(resourceMetadataUrl);
      rm = await r.json();
    } catch (e) {
      return fail(1, e instanceof Error ? e.message : String(e));
    }
    update(1, {
      status: "success",
      message: `authorization_servers: ${rm.authorization_servers.join(", ")}`,
      responseJson: rm,
    });

    // 3) Fetch authorization-server metadata via OUR proxy (so DCR is
    //    advertised). We could also hit the upstream Clerk URL directly.
    append({ name: "fetch authorization-server metadata", status: "running" });
    const asUrl =
      new URL(mcpEndpoint).origin +
      "/api/v1/.well-known/oauth-authorization-server";
    let as: {
      authorization_endpoint: string;
      token_endpoint: string;
      registration_endpoint?: string;
      scopes_supported?: string[];
    };
    try {
      const r = await fetch(asUrl);
      as = await r.json();
    } catch (e) {
      return fail(2, e instanceof Error ? e.message : String(e));
    }
    if (!as.registration_endpoint) {
      return fail(2, "no registration_endpoint — DCR proxy not deployed?");
    }
    update(2, { status: "success", message: "endpoints discovered", responseJson: as });

    // 4) DCR
    append({ name: "register client (DCR)", status: "running" });
    const callbackUrl = `${window.location.origin}/oauth-test/callback`;
    let dcr: { client_id: string };
    try {
      const r = await fetch(as.registration_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "mcpist OAuth tester",
          redirect_uris: [callbackUrl],
          scope: "openid profile email",
        }),
      });
      if (!r.ok) {
        const errText = await r.text();
        return fail(3, `DCR ${r.status}: ${errText.slice(0, 150)}`);
      }
      dcr = await r.json();
    } catch (e) {
      return fail(3, e instanceof Error ? e.message : String(e));
    }
    update(3, {
      status: "success",
      message: `client_id: ${dcr.client_id.slice(0, 24)}…`,
      responseJson: dcr,
    });

    // 5) PKCE
    append({ name: "generate PKCE", status: "running" });
    const verifier = randomBase64Url(32);
    const challenge = await sha256Base64Url(verifier);
    update(4, { status: "success", message: "S256 challenge ready" });

    // 6) Authorize popup → wait for postMessage
    append({ name: "authorize (popup → Clerk login)", status: "running" });
    const stateNonce = randomBase64Url(16);
    const authUrl = new URL(as.authorization_endpoint);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", dcr.client_id);
    authUrl.searchParams.set("redirect_uri", callbackUrl);
    authUrl.searchParams.set("scope", "openid profile email");
    authUrl.searchParams.set("state", stateNonce);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    const popup = window.open(
      authUrl.toString(),
      "mcpist-oauth-test",
      "width=600,height=700",
    );
    if (!popup) {
      return fail(5, "popup blocked");
    }

    let code: string;
    try {
      code = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("auth timed out (120s)")),
          120_000,
        );
        const handler = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return;
          const data = event.data as Partial<CallbackMessage> | undefined;
          if (data?.type !== "mcpist-oauth-test") return;
          window.removeEventListener("message", handler);
          clearTimeout(timer);
          if (data.error) {
            reject(new Error(data.errorDescription || data.error));
          } else if (data.state !== stateNonce) {
            reject(new Error("state mismatch (CSRF)"));
          } else if (!data.code) {
            reject(new Error("no code in callback"));
          } else {
            resolve(data.code);
          }
        };
        window.addEventListener("message", handler);
      });
    } catch (e) {
      popup.close();
      return fail(5, e instanceof Error ? e.message : String(e));
    }
    update(5, { status: "success", message: "code received" });

    // 7) Token exchange
    append({ name: "exchange code for access_token", status: "running" });
    let tok: { access_token: string; token_type: string; expires_in?: number };
    try {
      const r = await fetch(as.token_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: callbackUrl,
          client_id: dcr.client_id,
          code_verifier: verifier,
        }).toString(),
      });
      if (!r.ok) {
        const errText = await r.text();
        return fail(6, `token ${r.status}: ${errText.slice(0, 150)}`);
      }
      tok = await r.json();
    } catch (e) {
      return fail(6, e instanceof Error ? e.message : String(e));
    }
    setAccessToken(tok.access_token);
    update(6, {
      status: "success",
      message: `${tok.token_type} (${tok.expires_in ?? "?"}s)`,
      responseJson: {
        ...tok,
        access_token: tok.access_token.slice(0, 30) + "…",
      },
    });

    // 8) Use the token
    append({ name: "call /mcp with Bearer token", status: "running" });
    let mcpBody: { result?: { protocolVersion?: string }; error?: { message?: string } };
    try {
      const r = await fetch(mcpEndpoint, {
        method: "POST",
        // Same as the probe — suppress the cookie so we know the
        // success comes from the OAuth-issued Bearer, not the session.
        credentials: "omit",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tok.access_token}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "mcpist OAuth tester", version: "1.0" },
          },
        }),
      });
      mcpBody = await r.json();
    } catch (e) {
      return fail(7, e instanceof Error ? e.message : String(e));
    }
    if (mcpBody.error) {
      return fail(7, mcpBody.error.message ?? "MCP error");
    }
    update(7, {
      status: "success",
      message: `protocol v${mcpBody.result?.protocolVersion}`,
      responseJson: mcpBody,
    });

    setRunning(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">OAuth flow test</CardTitle>
        <p className="text-xs text-muted-foreground">
          Walk the same MCP-OAuth dance Claude.ai goes through: discovery →
          DCR → PKCE → Clerk login (popup) → token exchange → authenticated
          MCP call. Useful when a custom-connector add fails opaquely.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={run} disabled={running}>
          {running ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
          {running ? "Running…" : "Run OAuth flow"}
        </Button>

        {steps.length > 0 && (
          <div className="space-y-2">
            {steps.map((step, i) => {
              const isExpanded = expanded.has(i);
              const showCaret =
                step.responseJson !== undefined && step.responseJson !== null;
              return (
                <div
                  key={`${step.name}-${i}`}
                  className="rounded-md border bg-background/40"
                >
                  <button
                    onClick={() => showCaret && toggle(i)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2 text-left",
                      showCaret && "cursor-pointer hover:bg-accent/40",
                    )}
                  >
                    {step.status === "running" && (
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    )}
                    {step.status === "success" && (
                      <CheckCircle2 className="size-4 text-primary" />
                    )}
                    {step.status === "error" && (
                      <XCircle className="size-4 text-destructive" />
                    )}
                    {step.status === "pending" && (
                      <div className="size-4 rounded-full border border-muted-foreground/30" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-mono">{step.name}</div>
                      {step.message && (
                        <div
                          className={cn(
                            "text-xs",
                            step.status === "error"
                              ? "text-destructive"
                              : "text-muted-foreground",
                          )}
                        >
                          {step.message}
                        </div>
                      )}
                    </div>
                    {showCaret &&
                      (isExpanded ? (
                        <ChevronDown className="size-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 text-muted-foreground" />
                      ))}
                  </button>
                  {isExpanded && step.responseJson !== undefined && (
                    <pre className="border-t border-border/40 bg-muted/30 p-3 text-xs overflow-x-auto max-h-96">
                      {JSON.stringify(step.responseJson, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {accessToken && (
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-xs">
            <div className="font-medium mb-1">Access token (full)</div>
            <div className="font-mono break-all opacity-80">{accessToken}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
