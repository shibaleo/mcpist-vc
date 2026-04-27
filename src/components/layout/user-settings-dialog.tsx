"use client";

/**
 * Personal account settings dialog.
 *
 * mcpist parts: profile (read-only — display name comes from Clerk).
 * Plan / billing lives on its own page (`/settings`) because Stripe portal
 * redirect deserves more real estate than a dialog.
 */

import { useMe } from "@/components/auth/auth-gate";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserSettingsDialog({ open, onOpenChange }: Props) {
  const { me } = useMe();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Account</DialogTitle>
          <DialogDescription className="sr-only">
            Manage your account
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Profile
            </h3>
            <div className="space-y-1">
              <Label>Display name</Label>
              <p className="text-sm text-muted-foreground">
                {me.name || "—"}
              </p>
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <p className="text-sm text-muted-foreground">
                {me.email || "—"}
              </p>
            </div>
            <p className="text-xs text-muted-foreground pt-1">
              Profile is synced from Clerk. To edit, update your Clerk profile.
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
