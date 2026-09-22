"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { hasPermission, type Permission, type Role } from "@/lib/rbac";

const TABS: { href: string; label: string; permission: Permission }[] = [
  { href: "/settings/cloud-accounts", label: "Cloud accounts", permission: "aws_accounts:read" },
  { href: "/settings/members", label: "Members", permission: "members:read" },
  { href: "/settings/alerts", label: "Alert rules", permission: "alerts:manage" },
  { href: "/settings/workspace", label: "Workspace", permission: "org:read" },
  { href: "/settings/profile", label: "Profile & security", permission: "org:read" },
];

export function SettingsTabs({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="-mx-1 flex gap-1 overflow-x-auto border-b">
      {TABS.filter((t) => hasPermission(role, t.permission)).map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground",
              active ? "border-primary font-medium text-foreground" : "border-transparent",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
