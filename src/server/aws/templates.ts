import { ACTION_PERMISSIONS, DATA_PLANE_DENY, READ_PERMISSIONS } from "./permissions";

/**
 * Generates the customer-side IAM artefacts. All output is produced with JSON.stringify from
 * validated inputs (principal ARN from env, ExternalId from our CSPRNG), so no template
 * injection is possible.
 */

export const READ_ROLE_NAME = "StratusReadOnlyRole";
export const ACTION_ROLE_NAME = "StratusActionRole";
export const ACTION_TAG_KEY = "stratus:actions-allowed";

type PolicyDocument = {
  Version: "2012-10-17";
  Statement: Record<string, unknown>[];
};

export function trustPolicy(principalArn: string, externalId: string): PolicyDocument {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AllowStratusWithExternalId",
        Effect: "Allow",
        Principal: { AWS: principalArn },
        Action: "sts:AssumeRole",
        Condition: { StringEquals: { "sts:ExternalId": externalId } },
      },
    ],
  };
}

export function readOnlyPolicy(): PolicyDocument {
  const actions = READ_PERMISSIONS.map((p) => p.action).filter((a) => a !== "apigateway:GET");
  return {
    Version: "2012-10-17",
    Statement: [
      { Sid: "StratusReadOnlyMetadata", Effect: "Allow", Action: [...new Set(actions)].sort(), Resource: "*" },
      {
        Sid: "StratusApiGatewayInventory",
        Effect: "Allow",
        Action: "apigateway:GET",
        Resource: ["arn:aws:apigateway:*::/restapis", "arn:aws:apigateway:*::/apis", "arn:aws:apigateway:*::/tags/*"],
      },
    ],
  };
}

export function dataPlaneDenyPolicy(): PolicyDocument {
  return {
    Version: "2012-10-17",
    Statement: [{ Sid: "StratusDenyDataPlaneAndSecrets", Effect: "Deny", Action: [...DATA_PLANE_DENY], Resource: "*" }],
  };
}

/** Action role: EC2 start/stop/reboot ONLY on instances explicitly tagged by the customer. */
export function actionPolicy(): PolicyDocument {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "StratusTaggedInstanceActions",
        Effect: "Allow",
        Action: ACTION_PERMISSIONS.map((p) => p.action),
        Resource: "arn:aws:ec2:*:*:instance/*",
        Condition: { StringEquals: { [`aws:ResourceTag/${ACTION_TAG_KEY}`]: "true" } },
      },
    ],
  };
}

/** CloudFormation (JSON) template creating the read-only cross-account role. */
export function readOnlyRoleTemplate(principalArn: string, externalId: string): string {
  const template = {
    AWSTemplateFormatVersion: "2010-09-09",
    Description:
      "Stratus read-only cross-account role. Grants metadata read access only; explicitly denies data-plane reads and secret retrieval.",
    Resources: {
      StratusReadOnlyPolicy: {
        Type: "AWS::IAM::ManagedPolicy",
        Properties: { Description: "Stratus read-only metadata access", PolicyDocument: readOnlyPolicy() },
      },
      StratusDataPlaneDenyPolicy: {
        Type: "AWS::IAM::ManagedPolicy",
        Properties: { Description: "Stratus explicit deny of data-plane and secret reads", PolicyDocument: dataPlaneDenyPolicy() },
      },
      StratusReadOnlyRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          RoleName: READ_ROLE_NAME,
          Description: "Assumed by Stratus with an ExternalId for read-only inventory, cost and security posture.",
          MaxSessionDuration: 3600,
          AssumeRolePolicyDocument: trustPolicy(principalArn, externalId),
          ManagedPolicyArns: [{ Ref: "StratusReadOnlyPolicy" }, { Ref: "StratusDataPlaneDenyPolicy" }],
          Tags: [{ Key: "managed-by", Value: "stratus" }],
        },
      },
    },
    Outputs: {
      RoleArn: { Description: "Paste this ARN into the Stratus connection wizard.", Value: { "Fn::GetAtt": ["StratusReadOnlyRole", "Arn"] } },
    },
  };
  return JSON.stringify(template, null, 2);
}

/** CloudFormation template for the OPTIONAL action role (separate deployment, separate ExternalId use). */
export function actionRoleTemplate(principalArn: string, externalId: string): string {
  const template = {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: `Stratus OPTIONAL action role. Allows start/stop/reboot only for EC2 instances tagged ${ACTION_TAG_KEY}=true.`,
    Resources: {
      StratusActionRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          RoleName: ACTION_ROLE_NAME,
          MaxSessionDuration: 3600,
          AssumeRolePolicyDocument: trustPolicy(principalArn, externalId),
          Policies: [{ PolicyName: "StratusTaggedInstanceActions", PolicyDocument: actionPolicy() }],
          Tags: [{ Key: "managed-by", Value: "stratus" }],
        },
      },
    },
    Outputs: { RoleArn: { Value: { "Fn::GetAtt": ["StratusActionRole", "Arn"] } } },
  };
  return JSON.stringify(template, null, 2);
}

export function manualSetupCommands(): string[] {
  return [
    "aws iam create-role --role-name StratusReadOnlyRole --max-session-duration 3600 --assume-role-policy-document file://stratus-trust-policy.json",
    "aws iam create-policy --policy-name StratusReadOnlyPolicy --policy-document file://stratus-readonly-policy.json",
    "aws iam create-policy --policy-name StratusDataPlaneDenyPolicy --policy-document file://stratus-deny-policy.json",
    "aws iam attach-role-policy --role-name StratusReadOnlyRole --policy-arn arn:aws:iam::<ACCOUNT_ID>:policy/StratusReadOnlyPolicy",
    "aws iam attach-role-policy --role-name StratusReadOnlyRole --policy-arn arn:aws:iam::<ACCOUNT_ID>:policy/StratusDataPlaneDenyPolicy",
    "aws iam get-role --role-name StratusReadOnlyRole --query Role.Arn --output text",
  ];
}
