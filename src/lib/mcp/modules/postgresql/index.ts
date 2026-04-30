/**
 * PostgreSQL module — registers tools with the MCP module registry.
 *
 * Tool definitions live in `schemas.json` so they can be exported once and
 * reused by the Console UI without duplicating the descriptions.
 *
 * Connection string comes from the MCPIST_DATABASE_URL env var
 * (single-owner mode).
 */

import {
  type Module,
  type Tool,
  type ToolAnnotations,
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

const HANDLER_MAP: Record<
  string,
  (params: Record<string, unknown>) => Promise<string>
> = {
  test_connection: () => handlers.testConnection(),
  list_schemas: (p) => handlers.listSchemas(p),
  list_tables: (p) => handlers.listTables(p),
  describe_table: (p) => handlers.describeTable(p),
  query: (p) => handlers.queryTool(p),
  execute: (p) => handlers.executeTool(p),
  execute_ddl: (p) => handlers.executeDDL(p),
};

interface ToolSchemaEntry {
  id: string;
  name: string;
  description: string;
  annotation: keyof typeof ANNOTATION_MAP;
  inputSchema: Tool["inputSchema"];
}

const tools: Tool[] = (schemas.tools as unknown as ToolSchemaEntry[]).map((t) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  inputSchema: t.inputSchema,
  annotations: ANNOTATION_MAP[t.annotation],
}));

const postgresqlModule: Module = {
  name: "postgresql",
  description:
    "PostgreSQL Database — direct connection for query execution and schema inspection.",
  apiVersion: "v1",
  tools,
  async executeTool(toolName, params) {
    const fn = HANDLER_MAP[toolName];
    if (!fn) throw new Error(`unknown tool: ${toolName}`);
    return fn(params);
  },
};

registerModule(postgresqlModule);
