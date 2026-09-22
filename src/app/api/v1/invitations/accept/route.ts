import { NextResponse } from "next/server";
import { z } from "zod";
import { userRoute } from "@/server/http/route";
import { acceptInvitation } from "@/server/services/organization-service";
import { ACTIVE_ORG_COOKIE } from "@/server/services/workspace-context";
import { activeOrgCookieOptions } from "@/server/http/cookies";

export const POST = userRoute(
  {
    operation: "invitations.accept",
    body: z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/) }),
    rateLimit: "invite",
  },
  async ({ user, body, requestId }) => {
    const { organizationId } = await acceptInvitation(user, body.token);
    const res = NextResponse.json({ organizationId }, { headers: { "x-request-id": requestId, "cache-control": "no-store" } });
    res.cookies.set(ACTIVE_ORG_COOKIE, organizationId, activeOrgCookieOptions());
    return res;
  },
);
