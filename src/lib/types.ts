/** Client-safe DTO shapes returned by the API (no secrets by construction). */

export type ConnectionStatusValue =
  | "PENDING"
  | "CONNECTED"
  | "PERMISSION_PROBLEM"
  | "CONNECTION_FAILED"
  | "ROLE_UNAVAILABLE"
  | "NEEDS_ATTENTION"
  | "DISCONNECTED";

export interface ProbeResultDto {
  capability: string;
  label: string;
  iamAction: string;
  required: boolean;
  status: "OK" | "DENIED" | "NOT_ENABLED" | "ERROR";
  message?: string;
}

export interface AccountDto {
  id: string;
  awsAccountId: string;
  displayName: string;
  lastSyncedAt: string | null;
  syncStatus: "NEVER" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";
  syncError: string | null;
  connection: {
    method: "ASSUME_ROLE" | "ACCESS_KEY";
    roleArn: string | null;
    status: ConnectionStatusValue;
    statusMessage: string | null;
    diagnostics: { probes: ProbeResultDto[]; requiredOk: boolean; checkedAt: string } | null;
    enabledRegions: string[];
    regionAllowlist: string[];
    lastValidatedAt: string | null;
    accessKeyHint: string | null;
  } | null;
}

export interface SetupDto {
  awsAccountId: string;
  principalArn: string;
  externalId: string;
  roleName: string;
  cloudFormationTemplate: string;
  trustPolicy: unknown;
  readOnlyPolicy: unknown;
  denyPolicy: unknown;
  cliCommands: string[];
}
