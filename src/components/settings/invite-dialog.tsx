"use client";

import { Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errorMessage } from "@/lib/api-client";
import { canAssignRole, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, type Role } from "@/lib/rbac";

export function InviteDialog({
  orgId,
  actorRole,
  onInvited,
  children,
}: {
  orgId: string;
  actorRole: Role;
  onInvited: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>("VIEWER");
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const email = String(new FormData(e.currentTarget).get("email") ?? "");
      const res = await api<{ invitePath: string }>(`/api/v1/orgs/${orgId}/invitations`, { body: { email, role } });
      setLink(`${window.location.origin}${res.invitePath}`);
      onInvited();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setLink(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>The invitation is single-use, expires in 7 days and only works for the invited email.</DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="space-y-3">
            <Alert>
              <AlertDescription>Share this link with the invitee. It is shown only once.</AlertDescription>
            </Alert>
            <div className="flex gap-2">
              <Input readOnly value={link} aria-label="Invitation link" className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Copy link"
                onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success("Copied"))}
              >
                <Copy aria-hidden />
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4" id="invite-form">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" name="email" type="email" required maxLength={254} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger id="invite-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.filter((r) => canAssignRole(actorRole, r)).map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
            </div>
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? "Creating…" : "Create invitation"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
