import "server-only";
import { InvoicingClient, ListInvoiceSummariesCommand } from "@aws-sdk/client-invoicing";
import { z } from "zod";
import { createAwsClient } from "./client-factory";
import { paginate } from "./paginate";
import type { AwsSession } from "./session";

export const invoiceSchema = z.object({
  id: z.string().max(200), accountId: z.string().regex(/^\d{12}$/),
  issuedAt: z.string().datetime(), period: z.string().regex(/^\d{4}-\d{2}$/),
  amount: z.string().regex(/^-?\d+(\.\d+)?$/), currency: z.string().regex(/^[A-Z]{3}$/),
  type: z.string().max(100), issuer: z.string().max(200),
});
export type InvoiceSummary = z.infer<typeof invoiceSchema>;

/** Actual customer payment totals, including tax. Never reinterpret Cost Explorer USD as local money. */
export async function fetchInvoices(session: AwsSession, now = new Date()): Promise<InvoiceSummary[]> {
  if (session.partition !== "aws") throw new Error("Invoice API not configured for this partition");
  const client = createAwsClient(InvoicingClient, session, "us-east-1", "invoicing");
  try {
    const summaries = await paginate(
      (NextToken) => client.send(new ListInvoiceSummariesCommand({
        Selector: { ResourceType: "ACCOUNT_ID", Value: session.accountId },
        Filter: { TimeInterval: { StartDate: new Date(now.getTime() - 395 * 86400000), EndDate: now } },
        MaxResults: 100, NextToken,
      })), (p) => ({ items: p.InvoiceSummaries, nextToken: p.NextToken }), { maxItems: 1000 },
    );
    const invoices: InvoiceSummary[] = [];
    for (const invoice of summaries) {
      const payment = invoice.PaymentCurrencyAmount;
      const parsed = invoiceSchema.safeParse({
        id: invoice.InvoiceId, accountId: invoice.AccountId,
        issuedAt: invoice.IssuedDate?.toISOString(),
        period: `${invoice.BillingPeriod?.Year}-${String(invoice.BillingPeriod?.Month).padStart(2, "0")}`,
        amount: payment?.TotalAmount, currency: payment?.CurrencyCode,
        type: invoice.InvoiceType ?? "INVOICE", issuer: (invoice.Entity?.InvoicingEntity ?? "AWS").slice(0, 200),
      });
      // Do not silently turn a malformed page into an apparently complete invoice list.
      if (!parsed.success) throw new Error("Incomplete invoice amount or payment currency");
      if (parsed.data.accountId === session.accountId) invoices.push(parsed.data);
    }
    return [...new Map(invoices.map((i) => [i.id, i])).values()];
  } finally { client.destroy(); }
}
