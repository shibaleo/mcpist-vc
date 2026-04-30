/**
 * Streamable HTTP transport for MCP.
 *
 * MCP-over-HTTP receives a single JSON-RPC message per POST and returns the
 * response in the same response body. (Unlike SSE, there's no long-lived
 * connection — Vercel Functions are stateless.)
 *
 * Single-owner mode: no per-user routing, no ctx beyond what dispatch needs.
 */

import { dispatch } from "./handler";
import {
  RPC_PARSE_ERROR,
  RPC_INVALID_REQUEST,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./types";

function isJsonRpcRequest(v: unknown): v is JsonRpcRequest {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { jsonrpc?: unknown }).jsonrpc === "2.0" &&
    typeof (v as { method?: unknown }).method === "string"
  );
}

export async function handleMessage(
  body: unknown,
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
      const r = await dispatch(msg);
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
  return await dispatch(body);
}

export const RPC_PARSE_ERROR_RESPONSE: JsonRpcResponse = {
  jsonrpc: "2.0",
  id: null,
  error: { code: RPC_PARSE_ERROR, message: "parse error" },
};
