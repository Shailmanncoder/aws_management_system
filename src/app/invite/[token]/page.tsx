import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AcceptInvite } from "@/components/onboarding/accept-invite";
import { getCurrentUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Join workspace" };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) redirect("/");
  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <AcceptInvite token={token} email={user.email} />
    </main>
  );
}
