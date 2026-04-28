/**
 * /api/v1/me/modules — per-user tool enable state.
 *
 *   GET  /config           → flat list of (module, tool_id, enabled)
 *   PUT  /:name/tools      → bulk enable/disable tools for one module
 *
 * `tool_settings` is keyed by (user, tool_id). Module + tool existence is
 * verified against the in-process MCP module registry, so we can't desync
 * from the code that actually serves them.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import type { Env } from "@/lib/hono-app";
import { db } from "@/lib/db";
import { toolSettings } from "@/lib/db/schema";
import { getModule, listModules } from "@/lib/mcp/modules";

// Side-effect: ensure module registry is populated before /config is queried.
import "@/lib/mcp/modules/postgresql";
import "@/lib/mcp/modules/trello";

const upsertToolsBody = z.object({
  enabled_tools: z.array(z.string()),
  disabled_tools: z.array(z.string()),
});

const app = new Hono<Env>()
  .get("/config", async (c) => {
    const auth = c.get("authResult");
    const registered = listModules();
    if (registered.length === 0) return c.json({ data: [] });

    const allToolIds = registered.flatMap((m) => m.tools.map((t) => t.id));
    const userRows = await db
      .select({ toolId: toolSettings.toolId, enabled: toolSettings.enabled })
      .from(toolSettings)
      .where(
        and(
          eq(toolSettings.userId, auth.userId),
          inArray(toolSettings.toolId, allToolIds),
        ),
      );
    const enabledByTool = new Map<string, boolean>();
    for (const row of userRows) enabledByTool.set(row.toolId, row.enabled);

    const data: Array<{
      module_name: string;
      tool_id: string;
      enabled: boolean;
    }> = [];
    for (const mod of registered) {
      for (const tool of mod.tools) {
        data.push({
          module_name: mod.name,
          tool_id: tool.id,
          // No row → fall back to "read-only default-on, write default-off".
          enabled:
            enabledByTool.get(tool.id) ??
            (tool.annotations?.readOnlyHint ?? false),
        });
      }
    }

    return c.json({ data });
  })
  .put("/:name/tools", zValidator("json", upsertToolsBody), async (c) => {
    const auth = c.get("authResult");
    const name = c.req.param("name");
    const body = c.req.valid("json");

    const mod = getModule(name);
    if (!mod) return c.json({ error: `unknown module: ${name}` }, 404);
    const validToolIds = new Set(mod.tools.map((t) => t.id));

    const enabled = body.enabled_tools.filter((t) => validToolIds.has(t));
    const disabled = body.disabled_tools.filter((t) => validToolIds.has(t));

    const writes: Array<{ toolId: string; enabled: boolean }> = [
      ...enabled.map((t) => ({ toolId: t, enabled: true })),
      ...disabled.map((t) => ({ toolId: t, enabled: false })),
    ];
    for (const w of writes) {
      await db
        .insert(toolSettings)
        .values({
          userId: auth.userId,
          toolId: w.toolId,
          enabled: w.enabled,
        })
        .onConflictDoUpdate({
          target: [toolSettings.userId, toolSettings.toolId],
          set: { enabled: w.enabled, updatedAt: new Date() },
        });
    }

    return c.json({
      data: {
        success: true,
        enabled_count: enabled.length,
        disabled_count: disabled.length,
      },
    });
  });

export default app;
