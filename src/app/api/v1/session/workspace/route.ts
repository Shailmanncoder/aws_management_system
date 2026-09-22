import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeOrg } from "@/server/authz/guard";
import { userRoute } from "@/server/http/route";
import { uuidSchema } from "@/server/validation/common";
import { ACTIVE_ORG_COOKIE } from "@/server/services/workspace-context";
import { activeOrgCookieOptions } from "@/server/http/cookies";

/** Switch active workspace. Membership is verified before the selection cookie is set. */
export const POST = userRoute(
  { operation: "session.switch_workspace", body: z.strictObject({ organizationId: uuidSchema }), rateLimit: "api" },
  async ({ user, body, requestId }) => {
    const access = await authorizeOrg(user.id, body.organizationId, "org:read");
    const res = NextResponse.json({ ok: true }, { headers: { "x-request-id": requestId, "cache-control": "no-store" } });
    res.cookies.set(ACTIVE_ORG_COOKIE, access.organizationId, activeOrgCookieOptions());
    return res;
  },
);
