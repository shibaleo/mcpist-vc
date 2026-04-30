/**
 * /api/v1/mcp — Streamable HTTP transport endpoint.
 *
 * Authentication is enforced by the parent router middleware
 * (lib/hono-app.ts), so by the time we get here the request has been
 * proven to come from the owner.
 *
 * Side effect: ensures all built-in modules are imported so the registry
 * is populated. Each `import "@/lib/mcp/modules/<name>"` self-registers
 * via `registerModule(...)`.
 */

import { Hono } from "hono";
import {
  handleMessage,
  RPC_PARSE_ERROR_RESPONSE,
} from "@/lib/mcp/transport";

// Self-registering module imports.
import "@/lib/mcp/modules/postgresql";

const app = new Hono().post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(RPC_PARSE_ERROR_RESPONSE);
  }

  const result = await handleMessage(body);
  if (result === null) {
    return c.body(null, 202);
  }
  return c.json(result);
});

export default app;
