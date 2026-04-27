/**
 * MCP protocol types.
 *
 * Aligned 1:1 with the legacy Go server's `internal/modules/types.go`.
 * The on-the-wire shape (JSON-RPC, tool definition, content blocks) MUST
 * match because existing MCP clients are configured against the old wire
 * format. New tool definitions also flow into `mcpist.modules.tools` JSONB
 * for the Console UI, so any drift would break the modules page.
 */

// ── Localized strings (en-US / ja-JP) ─────────────────────────────────────

export type LocalizedText = Record<string, string>;

// ── Tool definition ───────────────────────────────────────────────────────

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export const ANNOTATE_READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
};
export const ANNOTATE_CREATE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
export const ANNOTATE_UPDATE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
export const ANNOTATE_DELETE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};
export const ANNOTATE_DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

export interface Property {
  type: string;
  description?: string;
  items?: Property;
  enum?: string[];
}

export interface InputSchema {
  type: "object";
  properties: Record<string, Property>;
  required?: string[];
}

export interface Tool {
  /** Stable ID e.g. "postgresql:query" */
  id: string;
  /** Display / execution name within the module */
  name: string;
  /** Runtime-selected description (after language pick) */
  description: string;
  /** Multilingual descriptions retained for export/sync */
  descriptions?: LocalizedText;
  inputSchema: InputSchema;
  annotations?: ToolAnnotations;
}

// ── Content blocks returned from a tool call ──────────────────────────────

export interface TextContent {
  type: "text";
  text: string;
}
export type ContentBlock = TextContent;

export interface ToolCallResult {
  content: ContentBlock[];
  isError?: boolean;
}

// ── Module interface ──────────────────────────────────────────────────────

export interface ModuleContext {
  userId: string;
}

export interface Module {
  name: string;
  description: string;
  descriptions?: LocalizedText;
  apiVersion: string;
  tools: Tool[];
  executeTool(
    ctx: ModuleContext,
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<string>;
}

// ── JSON-RPC ──────────────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcSuccess<T = unknown> {
  jsonrpc: "2.0";
  id: string | number | null;
  result: T;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_INTERNAL_ERROR = -32603;
