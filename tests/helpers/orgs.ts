import { expect } from "vitest";
import { POST as createOrg } from "@/app/api/v1/orgs/route";
import { POST as invite } from "@/app/api/v1/orgs/[orgId]/invitations/route";
import { POST as accept } from "@/app/api/v1/invitations/accept/route";
import { POST as startConn } from "@/app/api/v1/orgs/[orgId]/aws-accounts/route";
import { POST as validate } from "@/app/api/v1/orgs/[orgId]/aws-accounts/[accountId]/validate/route";
import { call, createUser, type TestUser } from "./app";

export async function newOrg(user: TestUser, name = "Acme") {
  const res = await call(createOrg, { user, body: { name } });
  expect(res.status).toBe(201);
  return res.body.organization as { id: string };
}

export async function addMember(owner: TestUser, orgId: string, role: string) {
  const member = await createUser(role.toLowerCase());
  const inv = await call(invite, { user: owner, params: { orgId }, body: { email: member.email, role } });
  expect(inv.status).toBe(200);
  const token = (inv.body.invitePath as string).split("/").pop()!;
  expect((await call(accept, { user: member, body: { token } })).status).toBe(200);
  return member;
}

/** Connects a fixture AWS account end-to-end and returns the account DTO. */
export async function connectFixtureAccount(user: TestUser, orgId: string, awsAccountId = "123456789012", role = "StratusReadOnlyRole") {
  const s = await call(startConn, { user, params: { orgId }, body: { awsAccountId, displayName: `Acct ${awsAccountId}` } });
  expect(s.status).toBe(200);
  const accountId = s.body.account.id as string;
  const v = await call(validate, { user, params: { orgId, accountId }, body: { roleArn: `arn:aws:iam::${awsAccountId}:role/${role}` } });
  return { accountId, validate: v };
}
