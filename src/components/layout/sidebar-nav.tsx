"use client";

import { SIMPLE_LABELS } from "@/lib/simple";
import { useSimpleMode } from "@/components/simple/mode";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { hasPermission, type Role } from "@/lib/rbac";
import { NAV_SECTIONS } from "./nav-items";

export function SidebarNav({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const simple = useSimpleMode();
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <nav aria-label="Main navigation" className="flex flex-col gap-5 px-3 py-5 text-sm">
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
                        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
                        active && "bg-sidebar-accent font-medium text-sidebar-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span>{simple ? SIMPLE_LABELS[item.href] ?? item.label : item.label}{simple && ["/cloud/ec2", "/cloud/s3"].includes(item.href) && <span className="ml-1 text-xs text-muted-foreground">{" "}{item.label}</span>}</span>
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
