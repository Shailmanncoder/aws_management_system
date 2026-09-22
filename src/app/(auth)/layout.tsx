import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { getCurrentUser } from "@/server/auth/session";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Already signed in → go straight to the Overview.
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-center">
          <Logo />
        </div>
        {children}
        <p className="text-center text-xs text-muted-foreground">
          Stratus never asks for AWS root credentials or long-term access keys.
        </p>
      </div>
    </main>
  );
}
