import { trustPolicy } from "@/server/aws/templates";
import type { Guardrails } from "@/lib/provisioning";

/** Action baseline produced by IAM Policy Autopilot; optional ACL/object-lock/PassRole
 * and platform STS actions removed because these workflows never request them. */
export function provisionerPolicy(
  accountId: string,
  connectionId: string,
  g: Guardrails,
) {
  const ec2 = (kind: string) => `arn:aws:ec2:*:${accountId}:${kind}/*`,
    bucket = `arn:aws:s3:::stratus-${connectionId}-*`;
  const region = { StringEquals: { "aws:RequestedRegion": g.allowedRegions } };
  const tags = {
    "aws:RequestTag/ManagedBy": "Stratus",
    "aws:RequestTag/ConnectionId": connectionId,
  };
  return {
    Version: "2012-10-17",
    Statement: [
      // EC2 Describe APIs and Price List GetProducts do not support resource-level scoping.
      {
        Sid: "ReadEC2Preflight",
        Effect: "Allow",
        Action: [
          "ec2:DescribeVolumes",
          "ec2:DescribeImages",
          "ec2:DescribeInstanceTypes",
          "ec2:DescribeInstances",
          "ec2:DescribeKeyPairs",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeSubnets",
        ],
        Resource: "*",
      },
      {
        Sid: "PriceList",
        Effect: "Allow",
        Action: ["pricing:GetProducts"],
        Resource: "*",
      },
      {
        Sid: "ApprovedImages",
        Effect: "Allow",
        Action: ["ec2:RunInstances"],
        Resource: "arn:aws:ec2:*::image/*",
        Condition: {
          StringEquals: {
            "aws:RequestedRegion": g.allowedRegions,
            "ec2:Owner": "amazon",
          },
        },
      },
      {
        Sid: "ExistingNetwork",
        Effect: "Allow",
        Action: ["ec2:RunInstances"],
        Resource: [
          ec2("subnet"),
          ec2("security-group"),
          ec2("key-pair"),
          ec2("network-interface"),
        ],
        Condition: region,
      },
      {
        Sid: "TaggedInstances",
        Effect: "Allow",
        Action: ["ec2:RunInstances"],
        Resource: ec2("instance"),
        Condition: {
          StringEquals: {
            ...tags,
            "aws:RequestedRegion": g.allowedRegions,
            "ec2:InstanceType": g.allowedInstanceTypes,
            "ec2:MetadataHttpTokens": "required",
          },
        },
      },
      {
        Sid: "EncryptedVolumes",
        Effect: "Allow",
        Action: ["ec2:RunInstances"],
        Resource: ec2("volume"),
        Condition: {
          StringEquals: {
            ...tags,
            "aws:RequestedRegion": g.allowedRegions,
            "ec2:VolumeType": "gp3",
          },
          Bool: { "ec2:Encrypted": "true" },
          NumericLessThanEquals: { "ec2:VolumeSize": g.maxStorageGiB },
        },
      },
      {
        Sid: "CreationTagsOnly",
        Effect: "Allow",
        Action: ["ec2:CreateTags"],
        Resource: [ec2("instance"), ec2("volume")],
        Condition: {
          StringEquals: {
            "ec2:CreateAction": "RunInstances",
            ...tags,
            "aws:RequestedRegion": g.allowedRegions,
          },
        },
      },
      {
        Sid: "CreateConnectionBuckets",
        Effect: "Allow",
        Action: ["s3:CreateBucket"],
        Resource: bucket,
        Condition: {
          StringEqualsIfExists: { "s3:LocationConstraint": g.allowedRegions },
          StringEquals: { "aws:RequestedRegion": g.allowedRegions },
        },
      },
      {
        Sid: "ConfigureConnectionBuckets",
        Effect: "Allow",
        Action: [
          "s3:PutBucketPublicAccessBlock",
          "s3:PutEncryptionConfiguration",
          "s3:PutBucketVersioning",
          "s3:PutBucketTagging",
        ],
        Resource: bucket,
        Condition: {
          StringEquals: {
            "s3:ResourceAccount": accountId,
            "aws:RequestedRegion": g.allowedRegions,
          },
        },
      },
      // HeadBucket uses ListBucket. No object data permissions are granted.
      {
        Sid: "VerifyConnectionBuckets",
        Effect: "Allow",
        Action: [
          "s3:ListBucket",
          "s3:GetBucketOwnershipControls",
          "s3:GetBucketPublicAccessBlock",
          "s3:GetEncryptionConfiguration",
          "s3:GetBucketVersioning",
          "s3:GetBucketTagging",
        ],
        Resource: bucket,
      },
    ],
  };
}
export function provisionerTemplate(
  principalArn: string,
  externalId: string,
  accountId: string,
  connectionId: string,
  g: Guardrails,
): string {
  return JSON.stringify(
    {
      AWSTemplateFormatVersion: "2010-09-09",
      Description:
        "Stratus separate EC2 and private S3 provisioning role. Deploy as a new stack; preserves read-only integration.",
      Resources: {
        StratusProvisionerRole: {
          Type: "AWS::IAM::Role",
          Properties: {
            RoleName: `StratusProvisionerRole-${connectionId}`,
            MaxSessionDuration: 3600,
            AssumeRolePolicyDocument: trustPolicy(principalArn, externalId),
            Policies: [
              {
                PolicyName: "StratusApprovedProvisioning",
                PolicyDocument: provisionerPolicy(accountId, connectionId, g),
              },
            ],
          },
        },
      },
      Outputs: {
        RoleArn: { Value: { "Fn::GetAtt": ["StratusProvisionerRole", "Arn"] } },
      },
    },
    null,
    2,
  );
}
