import { RefreshNow } from "@/components/aws/refresh-now";
import type { OrgAccess } from "@/server/authz/guard";
import { isUuid } from "@/server/validation/common";

/**
 * Page/section header actions: a Refresh button (only for roles with sync:trigger) followed by any
 * page-specific actions. `account` (e.g. the ?account= scope) narrows the sync to one AWS account.
 */
export function SectionActions({
  access,
  type = "INVENTORY_SYNC",
  account,
  label,
  children,
}: {
  access: OrgAccess;
  type?: "INVENTORY_SYNC" | "COST_SYNC";
  account?: unknown;
  label?: string;
  children?: React.ReactNode;
}) {
  const accountId = isUuid(account) ? account : undefined;
  return (
    <>
      {access.can("sync:trigger") && <RefreshNow orgId={access.organizationId} type={type} accountId={accountId} label={label} />}
      {children}
    </>
  );
}
