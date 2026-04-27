"use client";

/**
 * Modules — per-tool ON/OFF for the selected module.
 *
 * Layout mirrors the legacy Tools page: a single Select dropdown picks
 * the active module, and a single big Card lays out that module's tools
 * with switches plus annotation badges (ReadOnly / Destructive /
 * Idempotent). Bulk Select All / Deselect All buttons sit above the list.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { usePageTitle } from "@/lib/page-context";
import {
  useModulesList,
  useModuleConfig,
  useUpsertToolSettings,
  type ModuleListing,
} from "@/hooks/queries/use-modules";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Tool = ModuleListing["tools"][number];

export default function ModulesPage() {
  usePageTitle("Modules");
  const modulesQ = useModulesList();
  const configQ = useModuleConfig();
  const upsert = useUpsertToolSettings();

  const modules = modulesQ.data ?? [];
  const [selectedName, setSelectedName] = useState<string | null>(null);

  // Auto-select the first module once data lands so the page never
  // renders an empty detail area.
  useEffect(() => {
    if (selectedName === null && modules.length > 0) {
      setSelectedName(modules[0].name);
    }
  }, [modules, selectedName]);

  const selected = useMemo(
    () => modules.find((m) => m.name === selectedName) ?? null,
    [modules, selectedName],
  );

  const enabledByModule = useMemo(() => {
    const m = new Map<string, Map<string, boolean>>();
    for (const row of configQ.data ?? []) {
      const inner = m.get(row.module_name) ?? new Map<string, boolean>();
      inner.set(row.tool_id, row.enabled);
      m.set(row.module_name, inner);
    }
    return m;
  }, [configQ.data]);

  const enabledIn = (moduleName: string) =>
    enabledByModule.get(moduleName) ?? new Map<string, boolean>();

  const enabledCount = (mod: ModuleListing) => {
    const map = enabledIn(mod.name);
    return mod.tools.filter((t) => map.get(t.id)).length;
  };

  const onToggle = async (toolId: string, next: boolean) => {
    if (!selected) return;
    try {
      await upsert.mutateAsync({
        name: selected.name,
        enabled_tools: next ? [toolId] : [],
        disabled_tools: next ? [] : [toolId],
      });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.body.error : "Failed to update");
    }
  };

  const handleSelectAll = async () => {
    if (!selected) return;
    try {
      await upsert.mutateAsync({
        name: selected.name,
        enabled_tools: selected.tools.map((t) => t.id),
        disabled_tools: [],
      });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.body.error : "Failed");
    }
  };

  const handleDeselectAll = async () => {
    if (!selected) return;
    try {
      await upsert.mutateAsync({
        name: selected.name,
        enabled_tools: [],
        disabled_tools: selected.tools.map((t) => t.id),
      });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.body.error : "Failed");
    }
  };

  if (modulesQ.isLoading || configQ.isLoading) {
    return (
      <div className="p-6 grid place-items-center text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Modules</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Toggle which tools are exposed through your MCP endpoint.
        </p>
      </div>

      {/* Module picker */}
      <Select
        value={selectedName ?? undefined}
        onValueChange={(v) => setSelectedName(v)}
      >
        <SelectTrigger className="w-full sm:w-[320px] bg-card">
          <SelectValue placeholder="Select a module…">
            {selected && (
              <span className="flex items-center gap-2">
                <span>{selected.name}</span>
                <Badge variant="secondary" className="text-xs">
                  {enabledCount(selected)}/{selected.tools.length}
                </Badge>
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {modules.map((mod) => (
            <SelectItem key={mod.name} value={mod.name}>
              <span className="flex items-center gap-2">
                <span className="flex-1">{mod.name}</span>
                <Badge variant="secondary" className="text-xs">
                  {enabledCount(mod)}/{mod.tools.length}
                </Badge>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Selected module detail */}
      {selected && (
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg">{selected.name}</CardTitle>
                  <Badge
                    variant="outline"
                    className="border-primary/40 text-primary"
                  >
                    <CheckCircle2 className="size-3 mr-1" />
                    Connected
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {selected.description}
                </p>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm">Tools</h3>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSelectAll}
                  disabled={upsert.isPending}
                >
                  Select all
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDeselectAll}
                  disabled={upsert.isPending}
                >
                  Deselect all
                </Button>
              </div>
            </div>

            {selected.tools.map((tool) => (
              <ToolRow
                key={tool.id}
                tool={tool}
                enabled={!!enabledIn(selected.name).get(tool.id)}
                onChange={(v) => onToggle(tool.id, v)}
                disabled={upsert.isPending}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ToolRow({
  tool,
  enabled,
  onChange,
  disabled,
}: {
  tool: Tool;
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  const annotations = tool.annotations;
  const readOnly = annotations?.readOnlyHint === true;
  const destructive = annotations?.destructiveHint === true;
  const idempotent = annotations?.idempotentHint === true;

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3 rounded-lg border bg-background",
        // Slightly tinted background for tools that mutate destructively —
        // a visual nudge without making them un-toggleable.
        destructive && "border-destructive/30 bg-destructive/5",
      )}
    >
      <div className="pt-0.5">
        <Switch
          checked={enabled}
          onCheckedChange={onChange}
          disabled={disabled}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-medium">{tool.name}</span>
          {readOnly ? (
            <Badge
              variant="outline"
              className="text-xs border-primary/40 text-primary"
            >
              ReadOnly
            </Badge>
          ) : (
            <>
              {destructive && (
                <Badge
                  variant="outline"
                  className="text-xs border-destructive/50 text-destructive"
                >
                  <AlertTriangle className="size-3 mr-1" />
                  Destructive
                </Badge>
              )}
              {idempotent && (
                <Badge
                  variant="outline"
                  className="text-xs border-muted-foreground/40 text-muted-foreground"
                >
                  Idempotent
                </Badge>
              )}
            </>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">
          {tool.description}
        </p>
      </div>
    </div>
  );
}
