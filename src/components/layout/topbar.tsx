import { Bell } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { Role } from "@/lib/rbac";
import { CommandPalette } from "./command-palette";
import { LiveAlertsCount, LiveIndicator } from "./live-updates";
import { UserMenu } from "./user-menu";
import { WorkspaceSwitcher } from "./workspace-switcher";

export interface TopbarContext {
  user: { name: string; email: string };
  org: { id: string; name: string };
  role: Role;
  memberships: { id: string; name: string; role: Role }[];
}

export function Topbar({ ctx, children, openAlerts = 0 }: { ctx: TopbarContext; children?: React.ReactNode; openAlerts?: number }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <WorkspaceSwitcher
        current={{ id: ctx.org.id, name: ctx.org.name, role: ctx.role }}
        options={ctx.memberships.map((m) => ({ id: m.id, name: m.name, role: m.role }))}
      />
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
        <CommandPalette orgId={ctx.org.id} role={ctx.role} />
        {children}
        <LiveIndicator />
        <Button variant="ghost" size="icon" asChild>
          <Link href="/alerts" aria-label={openAlerts > 0 ? `Alerts: ${openAlerts} open` : "Alerts"} className="relative">
            <Bell className="size-4" aria-hidden />
            <LiveAlertsCount initial={openAlerts} />
          </Link>
        </Button>
        <UserMenu name={ctx.user.name} email={ctx.user.email} />
      </div>
    </div>
  );
}
