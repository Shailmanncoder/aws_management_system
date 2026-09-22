import { z } from "zod";
import { orgRoute } from "@/server/http/route";
import { searchResources } from "@/server/services/search-service";
import { searchTermSchema } from "@/server/validation/common";

export const GET = orgRoute(
  { operation: "search", permission: "inventory:read", query: z.strictObject({ q: searchTermSchema }), rateLimit: "search" },
  async ({ access, query }) => ({ results: await searchResources(access, query.q) }),
);
