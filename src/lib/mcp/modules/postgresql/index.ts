/**
 * PostgreSQL module — registers tools with the MCP module registry.
 *
 * Tool definitions live in `schemas.json` so they can be exported once and
 * reused by the Console UI without duplicating the descriptions. The
 * runtime `description` is selected from the localized map based on the
 * default UI locale (en-US for now; the legacy Go server's behaviour).
 */

import {
  type Module,
  type Tool,
  type ToolAnnotations,
  type ModuleContext,
  ANNOTATE_READ_ONLY,
  ANNOTATE_CREATE,
  ANNOTATE_DESTRUCTIVE,
} from "@/lib/mcp/types";
import { registerModule } from "@/lib/mcp/modules";
import schemas from "./schemas.json";
import * as handlers from "./tools";

const ANNOTATION_MAP: Record<string, ToolAnnotations> = {
  readOnly: ANNOTATE_READ_ONLY,
  create: ANNOTATE_CREATE,
  destructive: ANNOTATE_DESTRUCTIVE,
};

const MODULE_DESCRIPTIONS = {
  "en-US":
    "PostgreSQL Database - Direct connection for query execution and schema inspection",
  "ja-JP":
    "PostgreSQL データベース - クエリ実行とスキーマ確認のための直接接続",
};

const HANDLER_MAP: Record<
  string,
  (ctx: ModuleContext, params: Record<string, unknown>) => Promise<string>
> = {
  test_connection: (ctx) => handlers.testConnection(ctx),
  list_schemas: (ctx, p) => handlers.listSchemas(ctx, p),
  list_tables: (ctx, p) => handlers.listTables(ctx, p),
  describe_table: (ctx, p) => handlers.describeTable(ctx, p),
  query: (ctx, p) => handlers.queryTool(ctx, p),
  execute: (ctx, p) => handlers.executeTool(ctx, p),
  execute_ddl: (ctx, p) => handlers.executeDDL(ctx, p),
};

interface ToolSchemaEntry {
  id: string;
  name: string;
  descriptions: Record<string, string>;
  annotation: keyof typeof ANNOTATION_MAP;
  inputSchema: Tool["inputSchema"];
}

const tools: Tool[] = (schemas.tools as unknown as ToolSchemaEntry[]).map((t) => ({
  id: t.id,
  name: t.name,
  description: t.descriptions["en-US"],
  descriptions: t.descriptions,
  inputSchema: t.inputSchema,
  annotations: ANNOTATION_MAP[t.annotation],
}));

const postgresqlModule: Module = {
  name: "postgresql",
  description: MODULE_DESCRIPTIONS["en-US"],
  descriptions: MODULE_DESCRIPTIONS,
  apiVersion: "v1",
  tools,
  async executeTool(ctx, toolName, params) {
    const fn = HANDLER_MAP[toolName];
    if (!fn) throw new Error(`unknown tool: ${toolName}`);
    return fn(ctx, params);
  },
};

registerModule(postgresqlModule);
