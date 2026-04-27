"use client";

/**
 * Credentials — manage per-module credentials.
 *
 * Layout mirrors the legacy Services page: small horizontal tile cards
 * laid out in a 2/3-column grid, split into "Add" (not yet connected)
 * and "Connected" sections. Tiles are clickable; the dialog handles
 * connect / reconnect / disconnect.
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
import { useModulesList } from "@/hooks/queries/use-modules";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

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
  const [credBody, setCredBody] = useState("");

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

  const openDialog = (moduleName: string) => {
    setOpenModule(moduleName);
    setCredBody("");
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
    let parsed: unknown = credBody;
    const trimmed = credBody.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        toast.error("Invalid JSON");
        return;
      }
    }
    try {
      await upsert.mutateAsync({ module: openModule, credentials: parsed });
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

  const dialogIsConnected = openModule
    ? credByModule.has(openModule)
    : false;
  const dialogProviderName = openModule
    ? (oauthByModule.get(openModule)?.providerName ?? null)
    : null;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Credentials</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage credentials for each module. Encrypted at rest with
          AES-256-GCM; never returned in plaintext.
        </p>
      </div>

      {/* Add — not yet connected */}
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

      {/* Connected */}
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

      {/* Connect / disconnect dialog */}
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
                ? "Reconnect, replace the stored credential, or disconnect."
                : dialogProviderName
                  ? "Connect via OAuth or paste credentials manually."
                  : "Paste the connection string / API key / token JSON."}
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

            <div className="space-y-1.5">
              <Label>
                {dialogIsConnected
                  ? "Replace credential"
                  : "Credential (manual)"}
              </Label>
              <Textarea
                rows={5}
                value={credBody}
                onChange={(e) => setCredBody(e.target.value)}
                placeholder="postgresql://user:pass@host:5432/db"
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Raw string for connection strings / API keys, or JSON envelope
                for OAuth tokens.
              </p>
            </div>

            {openModule === "postgresql" && (
              <a
                href="https://neon.tech/docs/connect/connect-from-any-app"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Where do I find this?
                <ExternalLink className="size-3" />
              </a>
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
              <Button
                onClick={handleSaveManual}
                disabled={upsert.isPending || !credBody.trim()}
              >
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
 * at the bottom-right of the avatar (matching the legacy "online dot").
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
