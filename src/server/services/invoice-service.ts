import "server-only";
import { assertCan, type OrgAccess } from "../authz/guard";
import { invoiceSchema } from "../aws/invoices";
import { getDb } from "../db";
import { uuidSchema } from "../validation/common";

export async function getInvoiceOverview(access: OrgAccess, account?: string) {
  assertCan(access, "cost:read");
  const accounts = await getDb().awsAccount.findMany({
    where: { organizationId: access.organizationId, ...(account ? { id: uuidSchema.parse(account) } : {}) },
    select: { id: true, displayName: true, invoiceSummaries: true, invoiceSyncedAt: true, invoiceSyncError: true },
  });
  const now = Date.now();
  return accounts.map((a) => {
    const parsed = invoiceSchema.array().safeParse(a.invoiceSummaries);
    return { id: a.id, name: a.displayName, syncedAt: a.invoiceSyncedAt,
      stale: !a.invoiceSyncedAt || now - a.invoiceSyncedAt.getTime() > 26 * 3600_000,
      error: a.invoiceSyncError, invoices: parsed.success ? parsed.data.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)) : [] };
  });
}
