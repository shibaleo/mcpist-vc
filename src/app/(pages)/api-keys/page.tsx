"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Trash2, Plus, Copy, Check } from "lucide-react";
import { usePageTitle } from "@/lib/page-context";
import {
  useApiKeysList,
  useIssueApiKey,
  useRevokeApiKey,
  type IssuedApiKey,
} from "@/hooks/queries/use-api-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError } from "@/lib/api-client";

export default function ApiKeysPage() {
  usePageTitle("API Keys");
  const listQ = useApiKeysList();
  const issue = useIssueApiKey();
  const revoke = useRevokeApiKey();

  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [noExpiry, setNoExpiry] = useState(false);
  const [issued, setIssued] = useState<IssuedApiKey | null>(null);
  const [copied, setCopied] = useState(false);

  const handleIssue = async () => {
    if (!displayName.trim()) {
      toast.error("Name is required");
      return;
    }
    try {
      const res = await issue.mutateAsync({
        display_name: displayName.trim(),
        no_expiry: noExpiry,
      });
      setIssued(res.data);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.body.error : "Failed to issue");
    }
  };

  const handleRevoke = async (id: string, name: string) => {
    if (!confirm(`Revoke key "${name}"?`)) return;
    try {
      await revoke.mutateAsync({ id });
      toast.success("Revoked");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.body.error : "Failed to revoke");
    }
  };

  const handleCopy = async () => {
    if (!issued) return;
    await navigator.clipboard.writeText(issued.api_key);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const reset = () => {
    setDisplayName("");
    setNoExpiry(false);
    setIssued(null);
    setCopied(false);
    setOpen(false);
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          MCP-client API keys. Tokens are only shown once at creation.
        </p>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          New key
        </Button>
      </div>

      {listQ.isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (listQ.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No API keys yet.
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-md divide-y divide-border bg-card/40">
          {(listQ.data ?? []).map((k) => (
            <div
              key={k.id}
              className="flex items-center justify-between px-4 py-3 gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">
                  {k.display_name}
                </div>
                <div className="text-xs text-muted-foreground">
                  <code className="font-mono">{k.key_prefix}…</code>
                  <span className="mx-1">·</span>
                  Created {new Date(k.created_at).toLocaleDateString()}
                  {k.expires_at && (
                    <>
                      <span className="mx-1">·</span>
                      Expires {new Date(k.expires_at).toLocaleDateString()}
                    </>
                  )}
                  {!k.expires_at && <span className="mx-1">· No expiry</span>}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleRevoke(k.id, k.display_name)}
                disabled={revoke.isPending}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) reset();
          else setOpen(o);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {issued ? "Key created" : "New API key"}
            </DialogTitle>
            <DialogDescription>
              {issued
                ? "Copy the token now — it won't be shown again."
                : "Default expiry is 90 days."}
            </DialogDescription>
          </DialogHeader>

          {issued ? (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/40 p-3 font-mono text-xs break-all">
                {issued.api_key}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={handleCopy}>
                  {copied ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button onClick={reset}>Done</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. claude-desktop"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={noExpiry}
                  onChange={(e) => setNoExpiry(e.target.checked)}
                />
                No expiry
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={reset}>
                  Cancel
                </Button>
                <Button onClick={handleIssue} disabled={issue.isPending}>
                  {issue.isPending ? "Issuing…" : "Issue"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
