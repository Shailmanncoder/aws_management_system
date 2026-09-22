import { AlertTriangle, Inbox, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/** Consistent empty / error / no-access states. Never substitute fake data for missing data. */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center", className)}>
      <Icon className="size-6 text-muted-foreground" aria-hidden />
      <p className="font-medium">{title}</p>
      {description && <div className="max-w-md text-sm text-muted-foreground">{description}</div>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Data unavailable", description, className }: { title?: string; description?: React.ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn("flex items-start gap-3 rounded-lg border border-status-critical/30 bg-status-critical/5 px-4 py-3 text-sm", className)}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-critical" aria-hidden />
      <div>
        <p className="font-medium">{title}</p>
        {description && <div className="text-muted-foreground">{description}</div>}
      </div>
    </div>
  );
}

export function NoAccess({ what = "this page" }: { what?: string }) {
  return (
    <EmptyState
      icon={Lock}
      title="You don't have access"
      description={`Your role in this workspace does not include access to ${what}. Ask a workspace owner or admin.`}
    />
  );
}
