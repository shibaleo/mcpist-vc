"use client";

import { useState, useEffect } from "react";
import { Menu } from "lucide-react";
import { SITE_NAME } from "@/lib/site";
import { Sidebar, SidebarNav } from "./sidebar";
import { Sheet, SheetTrigger, SheetContent } from "@/components/ui/sheet";
import { UserMenu } from "./user-menu";
import { PageProvider, usePageContext } from "@/lib/page-context";

function LayoutInner({ children }: { children: React.ReactNode }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { title, subtitle, headerSlot, scrollingDown } = usePageContext();
  useEffect(() => setMounted(true), []);

  return (
    <div className="min-h-dvh flex flex-col md:h-dvh md:flex-row md:overflow-hidden">
      {/* Mobile header */}
      <header
        className={`sticky top-0 z-30 flex md:hidden h-14 shrink-0 items-center border-b border-sidebar-border bg-sidebar px-3 gap-3 transition-transform duration-200 ${
          scrollingDown ? "-translate-y-full" : "translate-y-0"
        }`}
      >
        {mounted ? (
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <button className="flex size-8 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
                <Menu className="size-5" />
              </button>
            </SheetTrigger>
            <SheetContent>
              <div className="flex h-14 items-center border-b border-sidebar-border px-3">
                <span className="text-lg font-semibold text-primary">
                  {SITE_NAME}
                </span>
              </div>
              <SidebarNav onNavigate={() => setSheetOpen(false)} />
            </SheetContent>
          </Sheet>
        ) : (
          <button className="flex size-8 items-center justify-center rounded-md text-sidebar-foreground/70">
            <Menu className="size-5" />
          </button>
        )}
        <span className="text-lg font-semibold truncate text-primary">
          {title || SITE_NAME}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {subtitle && (
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          )}
          {headerSlot}
          <UserMenu collapsed />
        </div>
      </header>

      {/* Desktop sidebar */}
      <Sidebar />

      <main className="flex-1 overflow-y-auto flex flex-col">
        <div
          className={`hidden md:flex items-center gap-2 px-4 min-h-12 transition-all duration-200 overflow-hidden ${
            scrollingDown ? "max-h-0 min-h-0 opacity-0" : "max-h-16 opacity-100"
          }`}
        >
          {title && !headerSlot && (
            <h1 className="text-lg font-semibold truncate">{title}</h1>
          )}
          {headerSlot && <div className="flex-1 min-w-0">{headerSlot}</div>}
          {!headerSlot && <div className="flex-1" />}
          {subtitle && (
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          )}
        </div>
        {children}
      </main>
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageProvider>
      <LayoutInner>{children}</LayoutInner>
    </PageProvider>
  );
}
