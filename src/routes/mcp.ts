/**
 * /api/v1/mcp — Streamable HTTP transport endpoint.
 *
 * Authentication is enforced by the parent router middleware
 * (lib/hono-app.ts), so by the time we get here `c.get("authResult")`
 * is set. We translate that to the MCP transport's userId.
 *
 * Side effect: ensures all built-in modules are imported so the registry
 * is populated. Each `import "@/lib/mcp/modules/<name>"` self-registers
 * via `registerModule(...)`.
 */

import { Hono } from "hono";
import type { Env } from "@/lib/hono-app";
import {
  handleMessage,
  RPC_PARSE_ERROR_RESPONSE,
} from "@/lib/mcp/transport";

// Self-registering module imports — add new modules here as they're ported.
import "@/lib/mcp/modules/postgresql";
import "@/lib/mcp/modules/trello";

const app = new Hono<Env>().post("/", async (c) => {
  const auth = c.get("authResult");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(RPC_PARSE_ERROR_RESPONSE);
  }

  const result = await handleMessage(body, { userId: auth.userId });
  if (result === null) {
    // Notification(s) only — MCP spec allows 202 No Content for this case.
    return c.body(null, 202);
  }
  return c.json(result);
});

export default app;
