"use client";

import { useState } from "react";
import { Link, usePathname } from "@/lib/router";
import { SITE_NAME } from "@/lib/site";
import {
  KeyRound,
  LayoutGrid,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Server,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UserMenu } from "./user-menu";

const EXPANDED_WIDTH = 224;
const COLLAPSED_WIDTH = 56;

interface NavItem {
  href: string;
  label: string;
  icon: typeof PanelLeftOpen;
  dividerAfter?: boolean;
}

/**
 * mcpist nav. MCP Server / Modules / Credentials / API Keys are user-facing;
 * OAuth Apps is an admin-style page for registering provider credentials.
 */
const navItems: NavItem[] = [
  { href: "/mcp-server", label: "MCP Server", icon: Server, dividerAfter: true },
  { href: "/modules", label: "Modules", icon: LayoutGrid },
  { href: "/credentials", label: "Credentials", icon: Lock },
  { href: "/api-keys", label: "API Keys", icon: KeyRound, dividerAfter: true },
  { href: "/oauth-apps", label: "OAuth Apps", icon: Plug },
];

export function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      <nav className="flex-1 p-2 overflow-y-auto">
        <div className="space-y-0.5">
          {navItems.map((item) => {
            // Longer-prefix item wins so /api-keys doesn't also activate /api.
            const active =
              pathname.startsWith(item.href) &&
              !navItems.some(
                (other) =>
                  other.href.length > item.href.length &&
                  other.href.startsWith(item.href) &&
                  pathname.startsWith(other.href),
              );
            return (
              <div key={item.href}>
                <Link
                  to={item.href}
                  title={item.label}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center rounded-md pl-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-sidebar-accent text-primary"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  )}
                >
                  <div className="relative shrink-0">
                    <item.icon className="size-4" />
                  </div>
                  <span
                    className={cn(
                      "whitespace-nowrap transition-opacity duration-200",
                      collapsed
                        ? "opacity-0 w-0 overflow-hidden"
                        : "opacity-100 ml-3",
                    )}
                  >
                    {item.label}
                  </span>
                </Link>
                {item.dividerAfter && (
                  <div className="border-t border-sidebar-border/50 my-1" />
                )}
              </div>
            );
          })}
        </div>
      </nav>

      <UserMenu collapsed={collapsed} />
    </>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const sidebarWidth = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;

  return (
    <aside
      className="hidden md:flex h-screen flex-col border-r border-sidebar-border bg-sidebar overflow-hidden transition-all duration-300"
      style={{ width: sidebarWidth }}
    >
      <div className="flex h-14 items-center border-b border-sidebar-border px-3 gap-2">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex shrink-0 size-8 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </button>
        <span
          className={cn(
            "truncate text-lg font-semibold text-primary whitespace-nowrap transition-opacity duration-200",
            collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100",
          )}
        >
          {SITE_NAME}
        </span>
      </div>

      <SidebarNav collapsed={collapsed} />
    </aside>
  );
}
