"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { hasPermission, type Role } from "@/lib/rbac";
import { NAV_SECTIONS } from "./nav-items";

export function SidebarNav({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <nav aria-label="Main navigation" className="flex flex-col gap-4 px-2 py-3 text-sm">
      {NAV_SECTIONS.map((section, i) => {
        const items = section.items.filter((item) => hasPermission(role, item.permission));
        if (items.length === 0) return null;
        return (
          <div key={section.label ?? i} className="space-y-0.5">
            {section.label && (
              <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{section.label}</p>
            )}
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active = isActive(item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
                        active && "bg-sidebar-accent font-medium text-sidebar-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
