import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TwoFactorSettings } from "@/components/settings/two-factor-settings";
import { getWorkspaceContext } from "@/server/services/workspace-context";

export const metadata: Metadata = { title: "Profile & security" };

export default async function ProfilePage() {
  const { user } = await getWorkspaceContext();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Name</dt>
            <dd>{user.name}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="break-all">{user.email}</dd>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>Protect your account with a TOTP authenticator app.</CardDescription>
        </CardHeader>
        <CardContent>
          <TwoFactorSettings enabled={user.twoFactorEnabled} />
        </CardContent>
      </Card>
    </div>
  );
}
