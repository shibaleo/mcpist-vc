"use client";

/**
 * OAuth Apps — admin-style CRUD for provider client credentials.
 *
 * Each row in the catalog is a provider supported by the OAuth flow. A row
 * is "configured" once the user enters client_id + client_secret here; from
 * that point the Connect button on the Credentials page becomes available.
 *
 * Empty client_secret on PUT means "leave unchanged" — convenient when
 * editing client_id or redirect_uri without re-pasting the secret.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Plug,
  Trash2,
} from "lucide-react";
import { usePageTitle } from "@/lib/page-context";
import {
  useOAuthAppsList,
  useUpsertOAuthApp,
  useDeleteOAuthApp,
  type OAuthAppRow,
} from "@/hooks/queries/use-oauth-apps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface FormState {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  enabled: boolean;
}

const blankForm: FormState = {
  client_id: "",
  client_secret: "",
  redirect_uri: "",
  enabled: true,
};

/**
 * Default redirect URI to suggest. The OAuth flow uses the request host
 * automatically, but registering a fixed value makes the provider-side
 * config simpler — show the current origin so the user can copy it.
 */
function suggestRedirectUri(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/api/v1/oauth/callback`;
}

export default function OAuthAppsPage() {
  usePageTitle("OAuth Apps");
  const listQ = useOAuthAppsList();
  const upsert = useUpsertOAuthApp();
  const del = useDeleteOAuthApp();

  const [selected, setSelected] = useState<OAuthAppRow | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [showSecret, setShowSecret] = useState(false);

  // Hydrate the form whenever a different provider is selected.
  useEffect(() => {
    if (!selected) return;
    setForm({
      client_id: selected.client_id ?? "",
      client_secret: "",
      redirect_uri: selected.redirect_uri ?? suggestRedirectUri(),
      enabled: selected.enabled ?? true,
    });
    setShowSecret(false);
  }, [selected]);

  const { configured, unconfigured } = useMemo(() => {
    const all = listQ.data ?? [];
    return {
      configured: all.filter((p) => p.configured),
      unconfigured: all.filter((p) => !p.configured),
    };
  }, [listQ.data]);

  const handleSave = async () => {
    if (!selected) return;
    if (!form.client_id.trim()) {
      toast.error("Client ID is required");
      return;
    }
    if (!selected.configured && !form.client_secret) {
      toast.error("Client Secret is required for new providers");
      return;
    }
    try {
      await upsert.mutateAsync({
        provider: selected.provider,
        client_id: form.client_id.trim(),
        client_secret: form.client_secret,
        redirect_uri: form.redirect_uri.trim() || undefined,
        enabled: form.enabled,
      });
      toast.success("Saved");
      setSelected(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.body.error : "Failed to save");
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!confirm(`Delete ${selected.name} OAuth app?`)) return;
    try {
      await del.mutateAsync({ provider: selected.provider });
      toast.success("Deleted");
      setSelected(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.body.error : "Failed to delete");
    }
  };

  if (listQ.isLoading) {
    return (
      <div className="p-6 grid place-items-center text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <p className="text-sm text-muted-foreground">
        Register OAuth client credentials per provider. Connect buttons on
        the Credentials page only show up once a provider is configured here.
      </p>

      {configured.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
            <CheckCircle2 className="size-4 text-primary" />
            Configured
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {configured.map((p) => (
              <ProviderTile key={p.provider} app={p} onClick={() => setSelected(p)} />
            ))}
          </div>
        </section>
      )}

      {unconfigured.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
            <Plug className="size-4 text-primary" />
            Not configured
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {unconfigured.map((p) => (
              <ProviderTile key={p.provider} app={p} onClick={() => setSelected(p)} />
            ))}
          </div>
        </section>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selected?.name}
              {selected?.configured && (
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  Configured
                </span>
              )}
            </DialogTitle>
            <DialogDescription>{selected?.description}</DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Client ID</Label>
                <Input
                  value={form.client_id}
                  onChange={(e) =>
                    setForm({ ...form, client_id: e.target.value })
                  }
                  placeholder="Enter client ID"
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="flex items-center gap-2">
                  Client Secret
                  {selected.configured && (
                    <span className="text-xs font-normal text-muted-foreground">
                      (leave empty to keep existing)
                    </span>
                  )}
                </Label>
                <div className="relative">
                  <Input
                    type={showSecret ? "text" : "password"}
                    value={form.client_secret}
                    onChange={(e) =>
                      setForm({ ...form, client_secret: e.target.value })
                    }
                    placeholder={
                      selected.configured ? "••••••••••••" : "Enter client secret"
                    }
                    className="font-mono text-sm pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 grid size-7 place-items-center rounded text-muted-foreground hover:bg-accent"
                  >
                    {showSecret ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Redirect URI</Label>
                <Input
                  value={form.redirect_uri}
                  onChange={(e) =>
                    setForm({ ...form, redirect_uri: e.target.value })
                  }
                  placeholder={suggestRedirectUri()}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Copy this URL into your OAuth app's redirect URI list.
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) =>
                    setForm({ ...form, enabled: e.target.checked })
                  }
                />
                Enabled
              </label>

              <a
                href={
                  selected.docs_url ??
                  "https://github.com/shibaleo/mcpist"
                }
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                Open developer console
                <ExternalLink className="size-3" />
              </a>
            </div>
          )}

          <DialogFooter className="flex-row sm:justify-between">
            <div>
              {selected?.configured && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={handleDelete}
                  disabled={del.isPending || upsert.isPending}
                >
                  {del.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setSelected(null)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={upsert.isPending}>
                {upsert.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProviderTile({
  app,
  onClick,
}: {
  app: OAuthAppRow;
  onClick: () => void;
}) {
  return (
    <Card
      onClick={onClick}
      className={cn(
        "py-3 cursor-pointer transition-colors hover:bg-accent/40",
        app.configured && "border-primary/40",
      )}
    >
      <CardContent className="px-4 py-0">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{app.name}</div>
            <div className="text-xs text-muted-foreground truncate">
              {app.description}
            </div>
          </div>
          {app.configured && (
            <CheckCircle2 className="size-4 text-primary shrink-0" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
