/**
 * /api/v1/modules — public list of installed modules with their tool defs.
 *
 * The list comes from the in-process MCP module registry (not the DB) so it
 * always reflects what this build can actually serve. The DB's `mcpist.modules`
 * table is a separate sync target used by the legacy admin tooling; we may
 * keep that in sync in a later phase.
 */

import { Hono } from "hono";
import { listModules } from "@/lib/mcp/modules";

// Side-effect import: registers all bundled modules.
import "@/lib/mcp/modules/postgresql";

const app = new Hono().get("/", (c) => {
  return c.json({
    data: listModules().map((mod) => ({
      name: mod.name,
      status: "active" as const,
      description: mod.description,
      descriptions: mod.descriptions ?? null,
      api_version: mod.apiVersion,
      tools: mod.tools.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        descriptions: t.descriptions ?? null,
        inputSchema: t.inputSchema,
        annotations: t.annotations ?? null,
      })),
    })),
  });
});

export default app;
