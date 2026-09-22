import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import { DescribeInstancesCommand, DescribeSecurityGroupsCommand, DescribeVpcsCommand, EC2Client } from "@aws-sdk/client-ec2";
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";
import { SecurityHubClient, DescribeHubCommand } from "@aws-sdk/client-securityhub";
import { CloudTrailClient } from "@aws-sdk/client-cloudtrail";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ECRClient } from "@aws-sdk/client-ecr";
import { ECSClient } from "@aws-sdk/client-ecs";
import { EKSClient } from "@aws-sdk/client-eks";
import { ElasticLoadBalancingV2Client } from "@aws-sdk/client-elastic-load-balancing-v2";
import { GuardDutyClient } from "@aws-sdk/client-guardduty";
import { IAMClient } from "@aws-sdk/client-iam";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { RDSClient } from "@aws-sdk/client-rds";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDiagnostics } from "@/server/aws/diagnostics";
import { AwsSession } from "@/server/aws/session";
import { useLiveAwsMode } from "../helpers/live-mode";

const denied = () => Object.assign(new Error("denied"), { name: "AccessDeniedException", $metadata: { httpStatusCode: 403 } });

describe("permission diagnostics", () => {
  useLiveAwsMode();
  const session = () => new AwsSession({ accountId: "123456789012", partition: "aws", kind: "assumed-role", sessionName: "t", credentials: { accessKeyId: "ASIAEXAMPLEEXAMPLE12", secretAccessKey: "x" } });

  // Every probed client is mocked so no unit test can reach the network.
  const others = [CloudTrailClient, CloudWatchClient, DynamoDBClient, ECRClient, ECSClient, EKSClient, ElasticLoadBalancingV2Client, GuardDutyClient, IAMClient, LambdaClient, RDSClient, EC2Client, S3Client, CostExplorerClient, SecurityHubClient];
  let mocks: ReturnType<typeof mockClient>[] = [];
  beforeEach(() => {
    mocks = others.map((C) => {
      const m = mockClient(C as never);
      m.onAnyCommand().resolves({});
      return m;
    });
  });
  afterEach(() => mocks.forEach((m) => m.restore()));

  it("reports missing IAM actions precisely and distinguishes not-enabled services", async () => {
    const ec2 = mockClient(EC2Client);
    ec2.on(DescribeInstancesCommand).resolves({});
    ec2.on(DescribeVpcsCommand).resolves({});
    ec2.on(DescribeSecurityGroupsCommand).rejects(denied());
    mockClient(S3Client).on(ListBucketsCommand).resolves({});
    mockClient(CostExplorerClient).on(GetCostAndUsageCommand).rejects(denied());
    mockClient(SecurityHubClient).on(DescribeHubCommand).rejects(Object.assign(new Error("x"), { name: "InvalidAccessException" }));
    void mocks;

    // Cost Explorer "not enabled" is an AccessDeniedException too — it must not be reported as a
    // missing IAM permission, because the fix is an account setting, not a policy change.
    mockClient(CostExplorerClient).on(GetCostAndUsageCommand).rejects(Object.assign(new Error("User not enabled for cost explorer access"), { name: "AccessDeniedException", $metadata: { httpStatusCode: 400 } }));
    const res = await runDiagnostics(session(), "us-east-1", { includeBilled: true });
    const by = (a: string) => res.probes.find((p) => p.iamAction === a)!;
    expect(by("ec2:DescribeInstances").status).toBe("OK");
    expect(by("ec2:DescribeSecurityGroups").status).toBe("DENIED");
    expect(by("ec2:DescribeSecurityGroups").message).toContain("Missing required AWS permission: ec2:DescribeSecurityGroups");
    expect(by("ce:GetCostAndUsage").status).toBe("NOT_ENABLED");
    expect(by("ce:GetCostAndUsage").message).toMatch(/Cost Explorer is not enabled/);
    expect(by("securityhub:DescribeHub").status).toBe("NOT_ENABLED");
    expect(res.requiredOk).toBe(false);
  });

  it("skips billed probes unless requested", async () => {
    const res = await runDiagnostics(session(), "us-east-1", { includeBilled: false });
    expect(res.probes.some((p) => p.iamAction === "ce:GetCostAndUsage")).toBe(false);
  });
});
