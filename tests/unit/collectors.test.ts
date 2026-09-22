import { DescribeInstancesCommand, EC2Client } from "@aws-sdk/client-ec2";
import { mockClient } from "aws-sdk-client-mock";
import { describe, expect, it } from "vitest";
import { ec2InstancesCollector, normalizeInstance, parseStoppedAt } from "@/server/aws/collectors/ec2";
import { tagsToRecord } from "@/server/aws/collectors/types";
import { normalizeIngress } from "@/server/aws/collectors/vpc";
import { AwsSession } from "@/server/aws/session";
import { buildSearchText } from "@/server/sync/persist";
import { useLiveAwsMode } from "../helpers/live-mode";

const session = () => new AwsSession({ accountId: "123456789012", partition: "aws", kind: "assumed-role", sessionName: "t", credentials: { accessKeyId: "ASIAEXAMPLEEXAMPLE12", secretAccessKey: "x" } });
const inst = (id: string, state = "running") => ({ InstanceId: id, InstanceType: "t3.micro", State: { Name: state }, Tags: [{ Key: "Name", Value: `n-${id}` }] }) as never;

describe("EC2 collector", () => {
  useLiveAwsMode();

  it("follows NextToken across all pages and skips terminated instances", async () => {
    const ec2 = mockClient(EC2Client);
    ec2.on(DescribeInstancesCommand, { NextToken: undefined }).resolves({ Reservations: [{ Instances: [inst("i-1"), inst("i-2")] }], NextToken: "p2" });
    ec2.on(DescribeInstancesCommand, { NextToken: "p2" }).resolves({ Reservations: [{ Instances: [inst("i-3", "terminated")] }], NextToken: "p3" });
    ec2.on(DescribeInstancesCommand, { NextToken: "p3" }).resolves({ Reservations: [{ Instances: [inst("i-4")] }] });
    const out = await ec2InstancesCollector.collect({ session: session(), region: "us-east-1", accountId: "123456789012" });
    expect(out.map((r) => r.resourceId)).toEqual(["i-1", "i-2", "i-4"]);
    expect(ec2.commandCalls(DescribeInstancesCommand)).toHaveLength(3);
    ec2.restore();
  });
});

describe("normalisers", () => {
  it("normalises instances with an explicit allow-list", () => {
    const r = normalizeInstance(
      {
        InstanceId: "i-abc",
        InstanceType: "m6i.large",
        State: { Name: "stopped" },
        StateTransitionReason: "User initiated (2026-08-10 12:30:00 GMT)",
        PublicIpAddress: "198.51.100.1",
        Tags: [{ Key: "Name", Value: "api" }, { Key: "team", Value: "core" }],
        // fields that must never be copied:
        KeyName: "prod-ssh-key",
      } as never,
      "us-east-1",
      "123456789012",
    )!;
    expect(r.name).toBe("api");
    expect(r.attributes.stoppedAt).toBe("2026-08-10T12:30:00.000Z");
    expect(r.arn).toBe("arn:aws:ec2:us-east-1:123456789012:instance/i-abc");
    expect(JSON.stringify(r)).not.toContain("prod-ssh-key");
  });

  it("parses only well-formed stop timestamps", () => {
    expect(parseStoppedAt("User initiated")).toBeNull();
    expect(parseStoppedAt(undefined)).toBeNull();
  });

  it("normalises security group rules including all-traffic and SG sources", () => {
    const rules = normalizeIngress([
      { IpProtocol: "-1", IpRanges: [{ CidrIp: "0.0.0.0/0" }] },
      { IpProtocol: "tcp", FromPort: 22, ToPort: 22, Ipv6Ranges: [{ CidrIpv6: "::/0" }], UserIdGroupPairs: [{ GroupId: "sg-1" }] },
    ]);
    expect(rules[0]).toEqual({ protocol: "-1", fromPort: null, toPort: null, sources: [{ type: "cidr", value: "0.0.0.0/0" }] });
    expect(rules[1]!.sources).toEqual([{ type: "ipv6", value: "::/0" }, { type: "sg", value: "sg-1" }]);
  });

  it("bounds tags and drops prototype-polluting keys", () => {
    const tags = tagsToRecord([{ Key: "__proto__", Value: "x" }, { Key: "a".repeat(300), Value: "b".repeat(400) }, ...Array.from({ length: 100 }, (_, i) => ({ Key: `k${i}`, Value: "v" }))]);
    expect(Object.keys(tags).length).toBeLessThanOrEqual(60);
    expect(Object.keys(tags).every((k) => k.length <= 128)).toBe(true);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("builds lower-cased search text with ids, IPs and tags", () => {
    const text = buildSearchText(
      { resourceType: "ec2:instance", region: "us-east-1", resourceId: "i-ABC", arn: null, name: "Web", state: "running", attributes: {}, tags: { Team: "Core" }, searchTerms: ["10.0.0.1"] },
      "123456789012",
    );
    expect(text).toContain("i-abc");
    expect(text).toContain("10.0.0.1");
    expect(text).toContain("team=core");
    expect(text).toContain("123456789012");
  });
});
