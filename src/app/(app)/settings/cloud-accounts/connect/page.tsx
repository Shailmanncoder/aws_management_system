import type { Metadata } from "next";
import { ConnectWizard } from "@/components/aws/connect-wizard";
import { NoAccess } from "@/components/common/states";
import type { AccountDto } from "@/lib/types";
import { toClient } from "@/server/http/serialize";
import { getAwsAccount } from "@/server/services/connection-service";
import { getPageAccess } from "@/server/services/workspace-context";
import { isUuid } from "@/server/validation/common";

export const metadata: Metadata = { title: "Connect AWS" };

export default async function ConnectPage({ searchParams }: PageProps<"/settings/cloud-accounts/connect">) {
  const { ctx, access } = await getPageAccess("aws_accounts:connect");
  if (!access) return <NoAccess what="connecting AWS accounts" />;
  const { resume } = await searchParams;
  const resumeAccount = isUuid(resume) ? await getAwsAccount(access, resume).catch(() => null) : null;
  return <ConnectWizard orgId={access.organizationId} orgName={ctx.org.name} resume={resumeAccount ? toClient<AccountDto>(resumeAccount) : undefined} />;
}
