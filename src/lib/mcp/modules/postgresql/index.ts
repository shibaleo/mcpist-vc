/**
 * PostgreSQL module — registers tools with the MCP module registry.
 *
 * Tool definitions live in `schemas.json` so they can be exported once and
 * reused by the Console UI without duplicating the descriptions. All
 * user-facing strings are English.
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
  credentialFields: [
    {
      name: "accessToken",
      label: "Connection string",
      type: "textarea",
      placeholder: "postgresql://user:pass@host:5432/db",
      help: "Standard libpq URL. SSL is appended automatically. localhost / 127.0.0.1 are blocked for SSRF safety.",
    },
  ],
  async executeTool(ctx, toolName, params) {
    const fn = HANDLER_MAP[toolName];
    if (!fn) throw new Error(`unknown tool: ${toolName}`);
    return fn(ctx, params);
  },
};

registerModule(postgresqlModule);
