import { ProvisioningSetup } from "@/components/aws/provisioning-setup";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountDetail } from "@/components/aws/account-detail";
import { NoAccess } from "@/components/common/states";
import type { AccountDto } from "@/lib/types";
import { isAppError } from "@/server/errors";
import { toClient } from "@/server/http/serialize";
import { getAwsAccount } from "@/server/services/connection-service";
import { getPageAccess } from "@/server/services/workspace-context";
import { isUuid } from "@/server/validation/common";

export const metadata: Metadata = { title: "AWS account" };

export default async function AccountPage({ params }: PageProps<"/settings/cloud-accounts/[accountId]">) {
  const { accountId } = await params;
  if (!isUuid(accountId)) notFound();
  const { access } = await getPageAccess("aws_accounts:read");
  if (!access) return <NoAccess what="cloud accounts" />;
  const account = await getAwsAccount(access, accountId).catch((e: unknown) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  return (
    <div className="space-y-5"><AccountDetail
      orgId={access.organizationId}
      account={toClient<AccountDto>(account)}
      canConnect={access.can("aws_accounts:connect")}
      canDisconnect={access.can("aws_accounts:disconnect")}
      canSync={access.can("sync:trigger")}
    />{access.can("provisioning:configure") && <ProvisioningSetup orgId={access.organizationId} accountId={accountId} />}</div>
  );
}
