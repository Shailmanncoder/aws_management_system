"use client";

import { ShieldCheck, ShieldOff, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api-client";
import { canAssignRole, hasPermission, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, type Role } from "@/lib/rbac";
import { InviteDialog } from "./invite-dialog";

interface Member {
  id: string;
  userId: string;
  role: Role;
  name: string;
  email: string;
  mfa: boolean;
  joinedAt: string;
}
interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
}

export function MembersManager({
  orgId,
  currentUserId,
  actorRole,
  members,
  invitations,
}: {
  orgId: string;
  currentUserId: string;
  actorRole: Role;
  members: Member[];
  invitations: Invitation[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const canManage = hasPermission(actorRole, "members:manage");
  const canInvite = hasPermission(actorRole, "members:invite");

  async function run(id: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(id);
    try {
      await fn();
      toast.success(ok);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Members</CardTitle>
            <CardDescription>Roles are enforced server-side on every request.</CardDescription>
          </div>
          {canInvite && (
            <InviteDialog orgId={orgId} actorRole={actorRole} onInvited={() => router.refresh()}>
              <Button size="sm">
                <UserPlus aria-hidden /> Invite
              </Button>
            </InviteDialog>
          )}
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Member</TableHead>
                <TableHead scope="col">Role</TableHead>
                <TableHead scope="col">MFA</TableHead>
                <TableHead scope="col">Joined</TableHead>
                {canManage && <TableHead scope="col"><span className="sr-only">Actions</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const self = m.userId === currentUserId;
                const editable = canManage && !self && canAssignRole(actorRole, m.role, m.role);
                return (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="font-medium">
                        {m.name} {self && <span className="text-xs text-muted-foreground">(you)</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">{m.email}</div>
                    </TableCell>
                    <TableCell>
                      {editable ? (
                        <Select
                          value={m.role}
                          disabled={busy === m.id}
                          onValueChange={(role) =>
                            void run(m.id, () => api(`/api/v1/orgs/${orgId}/members/${m.id}`, { method: "PATCH", body: { role } }), "Role updated")
                          }
                        >
                          <SelectTrigger className="h-8 w-40" aria-label={`Role for ${m.email}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLES.filter((r) => canAssignRole(actorRole, r, m.role)).map((r) => (
                              <SelectItem key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="secondary" title={ROLE_DESCRIPTIONS[m.role]}>
                          {ROLE_LABELS[m.role]}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {m.mfa ? (
                        <span className="inline-flex items-center gap-1 text-sm text-success-text">
                          <ShieldCheck className="size-4" aria-hidden /> Enabled
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                          <ShieldOff className="size-4" aria-hidden /> Off
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-sm text-muted-foreground">{new Date(m.joinedAt).toLocaleDateString()}</TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {editable && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${m.email}`}>
                                <Trash2 aria-hidden />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove {m.name}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {m.email} will immediately lose access to this workspace and all its AWS data.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => void run(m.id, () => api(`/api/v1/orgs/${orgId}/members/${m.id}`, { method: "DELETE" }), "Member removed")}
                                >
                                  Remove member
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canInvite && invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Email</TableHead>
                  <TableHead scope="col">Role</TableHead>
                  <TableHead scope="col">Expires</TableHead>
                  <TableHead scope="col"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>{i.email}</TableCell>
                    <TableCell>{ROLE_LABELS[i.role]}</TableCell>
                    <TableCell className="tabular text-sm text-muted-foreground">{new Date(i.expiresAt).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy === i.id}
                        onClick={() => void run(i.id, () => api(`/api/v1/orgs/${orgId}/invitations/${i.id}`, { method: "DELETE" }), "Invitation revoked")}
                      >
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
