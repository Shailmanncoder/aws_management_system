import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth/auth";

// Better Auth handles its own origin checks, rate limiting and cookie attributes.
export async function GET(req: Request) {
  return toNextJsHandler(getAuth()).GET(req);
}

export async function POST(req: Request) {
  return toNextJsHandler(getAuth()).POST(req);
}
