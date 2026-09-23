"use client";

import { ExperienceContext, ModeSwitch } from "@/components/simple/mode";
import { Menu } from "lucide-react";
import { useState } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Role } from "@/lib/rbac";
import { SidebarNav } from "./sidebar-nav";

export function AppShell({
  role,
  simple = true,
  topbar,
  banner,
  children,
}: {
  role: Role;
  simple?: boolean;
  topbar: React.ReactNode;
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <ExperienceContext value={simple}><div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="cloud-sidebar sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-18 items-center border-b px-5">
          <Logo />
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav role={role} />
        </div>
        <ModeSwitch />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="cloud-sidebar w-64 bg-sidebar p-0">
              <SheetHeader className="h-18 justify-center border-b px-4">
                <SheetTitle>
                  <Logo />
                </SheetTitle>
              </SheetHeader>
              <SidebarNav role={role} onNavigate={() => setOpen(false)} />
              <ModeSwitch />
            </SheetContent>
          </Sheet>
          {topbar}
        </header>
        {banner}
        <main id="main" className="flex-1 px-4 py-6 sm:px-7 lg:py-8">
          {children}
        </main>
      </div>
    </div></ExperienceContext>
  );
}
