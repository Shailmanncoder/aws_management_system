"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, errorMessage } from "@/lib/api-client";
import { ROLE_LABELS, type Role } from "@/lib/rbac";

export interface WorkspaceOption {
  id: string;
  name: string;
  role: Role;
}

export function WorkspaceSwitcher({ current, options }: { current: WorkspaceOption; options: WorkspaceOption[] }) {
  const router = useRouter();

  async function select(id: string) {
    if (id === current.id) return;
    try {
      await api("/api/v1/session/workspace", { method: "POST", body: { organizationId: id } });
      router.push("/");
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="max-w-52 justify-between gap-2 px-2" aria-label={`Workspace: ${current.name}`}>
          <span className="truncate font-medium">{current.name}</span>
          <ChevronsUpDown className="size-3.5 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Workspaces</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuItem key={o.id} onSelect={() => void select(o.id)} className="flex items-center justify-between gap-2">
            <span className="min-w-0">
              <span className="block truncate">{o.name}</span>
              <span className="block text-xs text-muted-foreground">{ROLE_LABELS[o.role]}</span>
            </span>
            {o.id === current.id && <Check className="size-4" aria-label="Current workspace" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding">
            <Plus className="size-4" aria-hidden /> New workspace
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
