import { z } from "zod";
export const cloudProvider = z.enum(["GCP", "AZURE"]);
export type CloudProvider = z.infer<typeof cloudProvider>;
const projectId = z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/);
const serviceAccount = z.object({ type: z.literal("service_account"), client_email: z.email().max(254), private_key: z.string().min(100).max(10000), project_id: projectId });
export const cloudInput = z.discriminatedUnion("provider", [
  z.strictObject({ provider: z.literal("GCP"), displayName: z.string().trim().min(2).max(80), projectId, serviceAccount,
    billingTable: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]\.[A-Za-z_][A-Za-z0-9_]{0,1023}\.[A-Za-z_][A-Za-z0-9_]{0,1023}$/).optional(),
    billingLocation: z.string().regex(/^[a-zA-Z0-9-]{2,40}$/).default("US"),
  }),
  z.strictObject({ provider: z.literal("AZURE"), displayName: z.string().trim().min(2).max(80), subscriptionId: z.uuid(), tenantId: z.uuid(), clientId: z.uuid(), clientSecret: z.string().min(8).max(4096) }),
]);
export type CloudInput = z.infer<typeof cloudInput>;
export interface CloudResource { id: string; name: string; type: string; region: string; }
export interface CloudCost { day: string; amount: number; currency: string; }
export interface CloudFinding { id: string; title: string; severity: string; resource: string; }
export interface CloudSnapshot { inventory: CloudResource[] | null; billing: CloudCost[] | null; security: CloudFinding[] | null; diagnostics: Record<string, string>; }
export interface CloudConnectionDto extends CloudSnapshot {
  id: string; provider: CloudProvider; externalId: string; displayName: string; status: string;
  inventoryAt: string | null; billingAt: string | null; securityAt: string | null; lastAttemptAt: string | null;
}
