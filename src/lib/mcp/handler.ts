/**
 * MCP method dispatcher.
 *
 * Implements the subset of MCP needed for the existing client integrations:
 *   - initialize / initialized
 *   - tools/list (flattened across all enabled modules for the user)
 *   - tools/call
 *
 * The legacy Go server was stateful (SSE), but every Vercel Function
 * invocation is fresh, so `initialize` is a pure function of the request and
 * we don't track session state. This is intentional — see MIGRATION_PLAN.md
 * §2.1 (Streamable HTTP only).
 */

import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { toolSettings } from "@/lib/db/schema";
import {
  RPC_METHOD_NOT_FOUND,
  RPC_INVALID_PARAMS,
  RPC_INTERNAL_ERROR,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type Tool,
  type ToolCallResult,
} from "./types";
import { getModule, listModules } from "./modules";

const PROTOCOL_VERSION = "2025-03-26";
const SERVER_NAME = "mcpist";
const SERVER_VERSION = "0.1.0";

interface DispatchCtx {
  userId: string;
}

function err(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

function ok<T>(id: string | number | null, result: T): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function handleInitialize(id: string | number | null): JsonRpcResponse {
  return ok(id, {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {
      tools: { listChanged: false },
    },
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
  });
}

/**
 * Tools/list — every enabled tool from every registered module the user has
 * granted access to. If the user has no `tool_settings` rows yet, every
 * tool from every registered module is exposed (initial-state default).
 */
async function handleToolsList(
  ctx: DispatchCtx,
  id: string | number | null,
): Promise<JsonRpcResponse> {
  const settings = await db
    .select({ toolId: toolSettings.toolId, enabled: toolSettings.enabled })
    .from(toolSettings)
    .where(eq(toolSettings.userId, ctx.userId));

  const enabledIds = new Set<string>();
  let hasAnySetting = false;
  for (const row of settings) {
    hasAnySetting = true;
    if (row.enabled) enabledIds.add(row.toolId);
  }

  const tools: Array<
    Pick<Tool, "name" | "description" | "inputSchema" | "annotations">
  > = [];
  for (const mod of listModules()) {
    for (const tool of mod.tools) {
      if (hasAnySetting && !enabledIds.has(tool.id)) continue;
      tools.push({
        // Wire-level `name` is the qualified tool ID — multiple modules can
        // expose tools with the same short name without collision.
        name: tool.id,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      });
    }
  }

  return ok(id, { tools });
}

async function handleToolsCall(
  ctx: DispatchCtx,
  id: string | number | null,
  params: Record<string, unknown> | undefined,
): Promise<JsonRpcResponse> {
  const name = params?.name;
  if (typeof name !== "string") {
    return err(id, RPC_INVALID_PARAMS, "missing 'name'");
  }
  const args =
    typeof params?.arguments === "object" && params.arguments !== null
      ? (params.arguments as Record<string, unknown>)
      : {};

  const colon = name.indexOf(":");
  if (colon < 0) {
    return err(id, RPC_INVALID_PARAMS, `invalid tool name: ${name}`);
  }
  const moduleName = name.slice(0, colon);
  const toolName = name.slice(colon + 1);

  const mod = getModule(moduleName);
  if (!mod) {
    return err(id, RPC_METHOD_NOT_FOUND, `unknown module: ${moduleName}`);
  }
  const tool = mod.tools.find((t) => t.name === toolName);
  if (!tool) {
    return err(
      id,
      RPC_METHOD_NOT_FOUND,
      `unknown tool: ${toolName} in module ${moduleName}`,
    );
  }

  // If the user has explicitly disabled this tool, refuse.
  const settings = await db
    .select({ enabled: toolSettings.enabled })
    .from(toolSettings)
    .where(
      and(
        eq(toolSettings.userId, ctx.userId),
        eq(toolSettings.toolId, tool.id),
      ),
    )
    .limit(1);
  if (settings.length > 0 && !settings[0].enabled) {
    return err(id, RPC_METHOD_NOT_FOUND, `tool disabled: ${tool.id}`);
  }

  let result: ToolCallResult;
  try {
    const text = await mod.executeTool({ userId: ctx.userId }, toolName, args);
    result = { content: [{ type: "text", text }] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result = { isError: true, content: [{ type: "text", text: msg }] };
  }
  return ok(id, result);
}

export async function dispatch(
  req: JsonRpcRequest,
  ctx: DispatchCtx,
): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  const method = req.method;
  const isNotification = req.id === undefined || req.id === null;

  try {
    switch (method) {
      case "initialize":
        return handleInitialize(id);
      case "initialized":
      case "notifications/initialized":
        return isNotification ? null : ok(id, {});
      case "ping":
        return ok(id, {});
      case "tools/list":
        return await handleToolsList(ctx, id);
      case "tools/call":
        return await handleToolsCall(ctx, id, req.params);
      case "resources/list":
        return ok(id, { resources: [] });
      case "prompts/list":
        // Prompts table dropped; return an empty list for clients that probe.
        return ok(id, { prompts: [] });
      default:
        return isNotification
          ? null
          : err(id, RPC_METHOD_NOT_FOUND, `method not found: ${method}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[mcp] dispatch error in ${method}:`, e);
    return err(id, RPC_INTERNAL_ERROR, msg);
  }
}
