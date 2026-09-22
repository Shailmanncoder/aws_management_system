import { NextResponse } from "next/server";
import { userRoute } from "@/server/http/route";
import { ACTIVE_ORG_COOKIE } from "@/server/services/workspace-context";
import { createOrgInput, createOrganization } from "@/server/services/organization-service";
import { activeOrgCookieOptions } from "@/server/http/cookies";

export const POST = userRoute(
  { operation: "org.create", body: createOrgInput, rateLimit: "orgCreate" },
  async ({ user, body, requestId }) => {
    const org = await createOrganization(user.id, body);
    const res = NextResponse.json({ organization: org }, { status: 201, headers: { "x-request-id": requestId, "cache-control": "no-store" } });
    res.cookies.set(ACTIVE_ORG_COOKIE, org.id, activeOrgCookieOptions());
    return res;
  },
);
