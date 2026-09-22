import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { CreateWorkspaceForm } from "@/components/onboarding/create-workspace-form";
import { getCurrentUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Create workspace" };

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/onboarding");
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <Logo />
        </div>
        <CreateWorkspaceForm />
      </div>
    </main>
  );
}
