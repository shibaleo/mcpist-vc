"use client";

import { useState } from "react";
import { useAuth } from "@clerk/react";
import { Settings, LogOut } from "lucide-react";
import { useMe } from "@/components/auth/auth-gate";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { UserSettingsDialog } from "./user-settings-dialog";

function Avatar({ name, className }: { name: string; className?: string }) {
  const initial = (name || "?").charAt(0).toUpperCase();
  return (
    <div
      className={cn(
        "flex shrink-0 size-8 items-center justify-center rounded-full bg-primary/20 text-primary text-sm font-semibold",
        className,
      )}
    >
      {initial}
    </div>
  );
}

export function UserMenu({ collapsed = false }: { collapsed?: boolean }) {
  const { me } = useMe();
  const { isSignedIn, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  async function handleLogout() {
    setOpen(false);
    if (isSignedIn) await signOut();
    window.location.href = "/";
  }

  const displayName = me.name || me.email || "Account";

  return (
    <>
      <div className="border-t border-sidebar-border px-3 py-3">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button className="flex w-full items-center gap-2 rounded-md p-1 -m-1 transition-colors hover:bg-sidebar-accent">
              <Avatar name={displayName} />
              <span
                className={cn(
                  "truncate text-sm text-sidebar-foreground whitespace-nowrap transition-opacity duration-200",
                  collapsed
                    ? "opacity-0 w-0 overflow-hidden"
                    : "opacity-100",
                )}
              >
                {displayName}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-56 p-1">
            <div className="px-3 py-2 border-b border-border">
              <p className="text-sm font-medium truncate">{displayName}</p>
              {me.email && (
                <p className="text-xs text-muted-foreground truncate">
                  {me.email}
                </p>
              )}
            </div>
            <div className="py-1">
              <button
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm transition-colors hover:bg-accent"
                onClick={() => {
                  setOpen(false);
                  setSettingsOpen(true);
                }}
              >
                <Settings className="size-4" />
                Account
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
                onClick={handleLogout}
              >
                <LogOut className="size-4" />
                Log out
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <UserSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
