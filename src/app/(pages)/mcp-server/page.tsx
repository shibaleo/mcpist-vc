"use client";

/**
 * MCP Server status + endpoint verification.
 *
 * Lets the user paste an API key (or any Bearer token) and probe their own
 * deployed MCP endpoint by issuing the canonical `initialize` → `tools/list`
 * sequence — the same handshake an MCP client does on first connect. Useful
 * for diagnosing "client says it can't connect" issues.
 *
 * Ports the legacy console's mcp-server page verification panel.
 */

import { useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Play,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { usePageTitle } from "@/lib/page-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StepStatus = "pending" | "running" | "success" | "error";

interface VerifyStep {
  name: string;
  status: StepStatus;
  message?: string;
  responseJson?: unknown;
  responseSize?: number;
}

const PROTOCOL_VERSION = "2025-03-26";

function getResponseSize(data: unknown): number {
  return new TextEncoder().encode(JSON.stringify(data)).length;
}

export default function McpServerPage() {
  usePageTitle("MCP Server");

  const endpoint = `${window.location.origin}/api/v1/mcp`;
  const [apiKey, setApiKey] = useState("");
  const [steps, setSteps] = useState<VerifyStep[]>([]);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);

  const updateStep = (i: number, patch: Partial<VerifyStep>) => {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  const toggleExpanded = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const handleCopy = async () => {
    await navigator.clipboard.writeText(endpoint);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  /**
   * The verification flow runs sequentially so a step's status update
   * survives the next step kicking off. The same Authorization header
   * is reused — failure on initialize aborts before we ever try tools/list.
   */
  const runVerify = async () => {
    if (!apiKey) {
      toast.error("API key is required");
      return;
    }
    setRunning(true);
    setExpanded(new Set());
    setSteps([
      { name: "initialize", status: "running" },
      { name: "tools/list", status: "pending" },
    ]);

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };

    // Step 1: initialize
    let initOk = false;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "mcpist console", version: "1.0.0" },
          },
        }),
      });
      const body = await res.json().catch(() => null);
      const size = body ? getResponseSize(body) : 0;

      if (res.status === 401) {
        updateStep(0, {
          status: "error",
          message: "Unauthorized (401)",
          responseJson: body,
          responseSize: size,
        });
      } else if (!res.ok) {
        updateStep(0, {
          status: "error",
          message: `HTTP ${res.status}`,
          responseJson: body,
          responseSize: size,
        });
      } else if (body?.error) {
        updateStep(0, {
          status: "error",
          message: body.error.message,
          responseJson: body,
          responseSize: size,
        });
      } else if (body?.result) {
        updateStep(0, {
          status: "success",
          message: `protocol v${body.result.protocolVersion}`,
          responseJson: body,
          responseSize: size,
        });
        initOk = true;
      } else {
        updateStep(0, {
          status: "error",
          message: "Unexpected response shape",
          responseJson: body,
          responseSize: size,
        });
      }
    } catch (e) {
      updateStep(0, {
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }

    if (!initOk) {
      updateStep(1, { status: "pending" });
      setRunning(false);
      return;
    }

    // Step 2: tools/list
    updateStep(1, { status: "running" });
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
        }),
      });
      const body = await res.json().catch(() => null);
      const size = body ? getResponseSize(body) : 0;

      if (!res.ok) {
        updateStep(1, {
          status: "error",
          message: `HTTP ${res.status}`,
          responseJson: body,
          responseSize: size,
        });
      } else if (body?.error) {
        updateStep(1, {
          status: "error",
          message: body.error.message,
          responseJson: body,
          responseSize: size,
        });
      } else if (body?.result) {
        const count = body.result.tools?.length ?? 0;
        updateStep(1, {
          status: "success",
          message: `${count} tool${count === 1 ? "" : "s"}`,
          responseJson: body,
          responseSize: size,
        });
      }
    } catch (e) {
      updateStep(1, {
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }

    setRunning(false);
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Endpoint */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Endpoint</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2 rounded-md border bg-background/40 px-3 py-2 font-mono text-xs">
            <span className="flex-1 truncate">{endpoint}</span>
            <Button variant="ghost" size="icon" onClick={handleCopy}>
              {copied ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            POST JSON-RPC 2.0 with{" "}
            <code className="font-mono">Authorization: Bearer mcpist_…</code>.
            Streamable HTTP only — no SSE.
          </p>
        </CardContent>
      </Card>

      {/* Verify */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Verify endpoint</CardTitle>
          <p className="text-xs text-muted-foreground">
            Probe the same handshake an MCP client makes:{" "}
            <code className="font-mono">initialize</code> →{" "}
            <code className="font-mono">tools/list</code>.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label>API key</Label>
              <Input
                type="password"
                placeholder="mcpist_…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <Button onClick={runVerify} disabled={running || !apiKey}>
              {running ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              {running ? "Running…" : "Run"}
            </Button>
          </div>

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
                      onClick={() => showCaret && toggleExpanded(i)}
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
                            {step.responseSize !== undefined && (
                              <span className="ml-1 opacity-70">
                                · {step.responseSize}B
                              </span>
                            )}
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
        </CardContent>
      </Card>
    </div>
  );
}
