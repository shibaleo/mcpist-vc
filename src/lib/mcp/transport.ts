/**
 * Streamable HTTP transport for MCP.
 *
 * MCP-over-HTTP receives a single JSON-RPC message per POST and returns the
 * response in the same response body. (Unlike SSE, there's no long-lived
 * connection — Vercel Functions are stateless and that's the whole reason
 * we ditched SSE in MIGRATION_PLAN.md §2.1.)
 *
 * MCP also defines a batch form (an array of requests). We accept both.
 */

import { dispatch } from "./handler";
import {
  RPC_PARSE_ERROR,
  RPC_INVALID_REQUEST,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./types";

interface TransportCtx {
  userId: string;
}

function isJsonRpcRequest(v: unknown): v is JsonRpcRequest {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { jsonrpc?: unknown }).jsonrpc === "2.0" &&
    typeof (v as { method?: unknown }).method === "string"
  );
}

/**
 * Handle one parsed JSON-RPC message (or batch). Returns the response body
 * to send back to the client, or null for notifications-only batches.
 */
export async function handleMessage(
  body: unknown,
  ctx: TransportCtx,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return {
        jsonrpc: "2.0",
        id: null,
        error: { code: RPC_INVALID_REQUEST, message: "empty batch" },
      };
    }
    const out: JsonRpcResponse[] = [];
    for (const msg of body) {
      if (!isJsonRpcRequest(msg)) {
        out.push({
          jsonrpc: "2.0",
          id: null,
          error: { code: RPC_INVALID_REQUEST, message: "invalid request" },
        });
        continue;
      }
      const r = await dispatch(msg, ctx);
      if (r) out.push(r);
    }
    return out.length > 0 ? out : null;
  }

  if (!isJsonRpcRequest(body)) {
    return {
      jsonrpc: "2.0",
      id: null,
      error: { code: RPC_INVALID_REQUEST, message: "invalid request" },
    };
  }
  return await dispatch(body, ctx);
}

export const RPC_PARSE_ERROR_RESPONSE: JsonRpcResponse = {
  jsonrpc: "2.0",
  id: null,
  error: { code: RPC_PARSE_ERROR, message: "parse error" },
};
