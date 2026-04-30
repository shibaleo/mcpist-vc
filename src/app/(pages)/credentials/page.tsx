"use client";

/**
 * Credentials — manage per-module credentials.
 *
 * Layout mirrors the legacy Services page: small horizontal tile cards
 * laid out in a 2/3-column grid, split into "Add" (not yet connected)
 * and "Connected" sections. Tiles are clickable; the dialog handles
 * connect / reconnect / disconnect.
 *
 * The manual-entry form is driven by each module's `credential_fields`
 * declaration (surfaced via /api/v1/modules). Field names map directly
 * into the broker's Credentials envelope, so what the user types lands
 * exactly where the module handler later reads it.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Cable,
  CircleCheckBig,
  ExternalLink,
  Link2,
  Loader2,
  Trash2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { usePageTitle } from "@/lib/page-context";
import {
  useCredentialsList,
  useUpsertCredential,
  useDeleteCredential,
  credentialsKeys,
} from "@/hooks/queries/use-credentials";
import { useModulesList, type ModuleListing } from "@/hooks/queries/use-modules";
import {
  useOAuthProviders,
  useOAuthStart,
  providerDefaultModule,
} from "@/hooks/queries/use-oauth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type CredentialField = NonNullable<ModuleListing["credential_fields"]>[number];

export default function CredentialsPage() {
  usePageTitle("Credentials");
  const credsQ = useCredentialsList();
  const modulesQ = useModulesList();
  const oauthQ = useOAuthProviders();
  const upsert = useUpsertCredential();
  const del = useDeleteCredential();
  const oauthStart = useOAuthStart();
  const qc = useQueryClient();

  const [openModule, setOpenModule] = useState<string | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  /**
   * The OAuth callback redirects back here with `?oauth=connected|error`.
   * Pop a toast, refresh creds, and clean the params so refresh doesn't
   * re-trigger.
   */
  useEffect(() => {
    const url = new URL(window.location.href);
    const status = url.searchParams.get("oauth");
    if (!status) return;
    const moduleName = url.searchParams.get("module") ?? "";
    const message = url.searchParams.get("message") ?? "";
    if (status === "connected") {
      toast.success(`Connected ${moduleName}`);
      qc.invalidateQueries({ queryKey: credentialsKeys.all });
    } else if (status === "error") {
      toast.error(message || "OAuth failed");
    }
    url.searchParams.delete("oauth");
    url.searchParams.delete("module");
    url.searchParams.delete("message");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [qc]);

  // (module → credential row) lookup so tiles know if a module is connected.
  const credByModule = useMemo(() => {
    const m = new Map<string, { updated_at: string }>();
    for (const c of credsQ.data ?? []) m.set(c.module, c);
    return m;
  }, [credsQ.data]);

  // (module → provider name) lookup for the "Connect via OAuth" branch.
  const oauthByModule = useMemo(() => {
    const m = new Map<string, { providerName: string }>();
    for (const p of oauthQ.data ?? []) {
      const target = providerDefaultModule[p.provider] ?? p.provider;
      m.set(target, { providerName: p.name });
    }
    return m;
  }, [oauthQ.data]);

  const modules = modulesQ.data ?? [];
  const connected = modules.filter((m) => credByModule.has(m.name));
  const notConnected = modules.filter((m) => !credByModule.has(m.name));

  const moduleByName = useMemo(() => {
    const m = new Map<string, ModuleListing>();
    for (const mod of modules) m.set(mod.name, mod);
    return m;
  }, [modules]);

  const openMod = openModule ? (moduleByName.get(openModule) ?? null) : null;
  const dialogFields: CredentialField[] = openMod?.credential_fields ?? [];
  const dialogIsConnected = openModule
    ? credByModule.has(openModule)
    : false;
  const dialogProviderName = openModule
    ? (oauthByModule.get(openModule)?.providerName ?? null)
    : null;

  const openDialog = (moduleName: string) => {
    setOpenModule(moduleName);
    setFieldValues({});
  };

  const handleConnectOAuth = async (moduleName: string) => {
    try {
      const r = await oauthStart.mutateAsync({ module: moduleName });
      window.location.href = r.data.authorize_url;
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.body.error : "Failed to start OAuth",
      );
    }
  };

  const handleSaveManual = async () => {
    if (!openModule) return;

    let credentials: unknown;
    if (dialogFields.length > 0) {
      // Build a structured Credentials object from the form values. Empty
      // strings are dropped so optional-field defaults stay clean.
      const obj: Record<string, string> = {};
      for (const f of dialogFields) {
        const v = (fieldValues[f.name] ?? "").trim();
        if (v) obj[f.name] = v;
      }
      // Required-field check: treat every declared field as required for
      // now. Optional fields would need a flag in the schema.
      const missing = dialogFields
        .filter((f) => !obj[f.name])
        .map((f) => f.label);
      if (missing.length > 0) {
        toast.error(`Required: ${missing.join(", ")}`);
        return;
      }
      credentials = obj;
    } else {
      // No declared schema → fall back to a single freeform string.
      const v = (fieldValues.__raw ?? "").trim();
      if (!v) {
        toast.error("Credential is required");
        return;
      }
      credentials = v;
    }

    try {
      await upsert.mutateAsync({ module: openModule, credentials });
      toast.success("Saved");
      setOpenModule(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.body.error : "Failed to save");
    }
  };

  const handleDisconnect = async () => {
    if (!openModule) return;
    if (!confirm(`Disconnect ${openModule}?`)) return;
    try {
      await del.mutateAsync({ module: openModule });
      toast.success("Disconnected");
      setOpenModule(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.body.error : "Failed to disconnect");
    }
  };

  if (modulesQ.isLoading) {
    return (
      <div className="p-6 grid place-items-center text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Credentials</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage credentials for each module. Encrypted at rest with
          AES-256-GCM; never returned in plaintext.
        </p>
      </div>

      {notConnected.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Cable className="size-5 text-primary" />
            Add
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {notConnected.map((mod) => (
              <Tile
                key={mod.name}
                name={mod.name}
                description={mod.description}
                onClick={() => openDialog(mod.name)}
              />
            ))}
          </div>
        </section>
      )}

      {connected.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <CircleCheckBig className="size-5 text-primary" />
            Connected
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {connected.map((mod) => (
              <Tile
                key={mod.name}
                name={mod.name}
                description={mod.description}
                connected
                onClick={() => openDialog(mod.name)}
              />
            ))}
          </div>
        </section>
      )}

      <Dialog
        open={!!openModule}
        onOpenChange={(o) => !o && setOpenModule(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {openModule}
              {dialogIsConnected && (
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  Connected
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              {dialogIsConnected
                ? "Reconnect, replace stored values, or disconnect."
                : dialogProviderName
                  ? "Connect via OAuth, or enter the credentials manually."
                  : "Enter the credentials this module needs to talk to its provider."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {dialogProviderName && (
              <Button
                onClick={() => openModule && handleConnectOAuth(openModule)}
                disabled={oauthStart.isPending}
                className="w-full"
              >
                <Link2 className="size-4" />
                {dialogIsConnected
                  ? `Reconnect ${dialogProviderName}`
                  : `Connect ${dialogProviderName}`}
              </Button>
            )}

            {/* Schema-driven manual fields */}
            {dialogFields.length > 0 ? (
              dialogFields.map((f) => (
                <CredentialFieldInput
                  key={f.name}
                  field={f}
                  value={fieldValues[f.name] ?? ""}
                  onChange={(v) =>
                    setFieldValues((prev) => ({ ...prev, [f.name]: v }))
                  }
                />
              ))
            ) : (
              // Module declared no schema — single freeform field. Rare;
              // most production modules should declare credential_fields.
              <div className="space-y-1.5">
                <Label>Credential</Label>
                <Textarea
                  rows={4}
                  value={fieldValues.__raw ?? ""}
                  onChange={(e) =>
                    setFieldValues((prev) => ({
                      ...prev,
                      __raw: e.target.value,
                    }))
                  }
                  className="font-mono text-xs"
                />
              </div>
            )}
          </div>

          <DialogFooter className="flex-row sm:justify-between">
            <div>
              {dialogIsConnected && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={handleDisconnect}
                  disabled={del.isPending}
                >
                  {del.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                  Disconnect
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpenModule(null)}>
                Cancel
              </Button>
              <Button onClick={handleSaveManual} disabled={upsert.isPending}>
                {upsert.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface TileProps {
  name: string;
  description: string;
  connected?: boolean;
  onClick: () => void;
}

/**
 * Service tile: 10x10 monogram avatar (initials) + name + truncated
 * description. Connected tiles get a primary-colored ring + a small dot
 * at the bottom-right of the avatar.
 */
function Tile({ name, description, connected, onClick }: TileProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-3 p-3 rounded-xl border bg-card/70 hover:bg-muted/50 transition-colors cursor-pointer",
        connected && "border-primary/40",
      )}
    >
      <div className="relative w-10 h-10 rounded-lg bg-background flex items-center justify-center shrink-0 text-sm font-semibold uppercase text-muted-foreground">
        {name.slice(0, 2)}
        {connected && (
          <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-primary ring-2 ring-card" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-sm truncate">{name}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          {description}
        </div>
      </div>
    </div>
  );
}

function CredentialFieldInput({
  field,
  value,
  onChange,
}: {
  field: CredentialField;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{field.label}</Label>
      {field.type === "textarea" ? (
        <Textarea
          rows={4}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? ""}
          className="font-mono text-xs"
        />
      ) : (
        <Input
          type={field.type === "password" ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? ""}
          className="font-mono text-xs"
        />
      )}
      {(field.help || field.helpUrl) && (
        <p className="text-[11px] text-muted-foreground">
          {field.help}
          {field.helpUrl && (
            <>
              {field.help ? " " : ""}
              <a
                href={field.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                Open
                <ExternalLink className="size-3" />
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
