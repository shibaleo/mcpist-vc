/**
 * MCP method dispatcher.
 *
 * Implements the subset of MCP needed for the existing client integrations:
 *   - initialize / initialized
 *   - tools/list (flattened across all registered modules — all on)
 *   - tools/call
 *
 * Single-owner mode: no per-user filtering, no DB. Every Vercel Function
 * invocation is fresh, so `initialize` is a pure function of the request.
 */

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

function handleToolsList(id: string | number | null): JsonRpcResponse {
  const tools: Array<
    Pick<Tool, "name" | "description" | "inputSchema" | "annotations">
  > = [];
  for (const mod of listModules()) {
    for (const tool of mod.tools) {
      tools.push({
        // Wire-level `name` must match Claude.ai's regex
        // ^[a-zA-Z0-9_-]{1,64}$ — colons aren't allowed, so we use
        // `<module>_<short>` instead of the internal `<module>:<short>`
        // tool ID. tools/call splits this back via the registered
        // module-name prefix (see resolveTool).
        name: wireToolName(mod.name, tool.name),
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      });
    }
  }
  return ok(id, { tools });
}

function wireToolName(moduleName: string, toolName: string): string {
  return `${moduleName}_${toolName}`;
}

function resolveWireName(
  wireName: string,
): { moduleName: string; toolName: string } | null {
  for (const mod of listModules()) {
    const prefix = `${mod.name}_`;
    if (wireName.startsWith(prefix)) {
      return {
        moduleName: mod.name,
        toolName: wireName.slice(prefix.length),
      };
    }
  }
  return null;
}

async function handleToolsCall(
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

  const resolved = resolveWireName(name);
  if (!resolved) {
    return err(id, RPC_INVALID_PARAMS, `invalid tool name: ${name}`);
  }
  const { moduleName, toolName } = resolved;

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

  let result: ToolCallResult;
  try {
    const text = await mod.executeTool(toolName, args);
    result = { content: [{ type: "text", text }] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result = { isError: true, content: [{ type: "text", text: msg }] };
  }
  return ok(id, result);
}

export async function dispatch(
  req: JsonRpcRequest,
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
        return handleToolsList(id);
      case "tools/call":
        return await handleToolsCall(id, req.params);
      case "resources/list":
        return ok(id, { resources: [] });
      case "prompts/list":
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
