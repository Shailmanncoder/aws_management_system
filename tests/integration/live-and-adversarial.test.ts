import { beforeAll, describe, expect, it } from "vitest";
import { GET as live } from "@/app/api/v1/orgs/[orgId]/live/route";
import { GET as search } from "@/app/api/v1/orgs/[orgId]/search/route";
import { APP_URL, call, createUser, type TestUser } from "../helpers/app";
import { connectFixtureAccount, newOrg } from "../helpers/orgs";

const NUL = String.fromCharCode(0);
const ESC = String.fromCharCode(27);

async function readFirstEvent(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  let text = "";
  const deadline = Date.now() + 5000;
  while (!text.includes("event: snapshot") && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  await reader.cancel();
  return text;
}

describe("live stream and adversarial inputs", () => {
  let owner: TestUser;
  let orgId: string;

  beforeAll(async () => {
    owner = await createUser("live");
    orgId = (await newOrg(owner, "Live Org")).id;
    await connectFixtureAccount(owner, orgId);
  });

  it("streams a tenant-scoped snapshot with no secret material", async () => {
    const ctrl = new AbortController();
    const req = new Request(`${APP_URL}/api/v1/orgs/${orgId}/live`, { headers: { cookie: owner.cookie }, signal: ctrl.signal });
    const res = await live(req, { params: Promise.resolve({ orgId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await readFirstEvent(res);
    ctrl.abort();
    expect(text).toContain("inventoryVersion");
    expect(text).not.toMatch(/externalId|SecretAccessKey|SessionToken|ASIA|stratus-[A-Za-z0-9_-]{20}/);
  });

  it("non-members and anonymous users cannot subscribe", async () => {
    const other = await createUser("live-other");
    const res = await live(new Request(`${APP_URL}/api/v1/orgs/${orgId}/live`, { headers: { cookie: other.cookie } }), { params: Promise.resolve({ orgId }) });
    expect(res.status).toBe(404);
    const anon = await live(new Request(`${APP_URL}/api/v1/orgs/${orgId}/live`), { params: Promise.resolve({ orgId }) });
    expect(anon.status).toBe(401);
  });

  it("rejects hostile search input", async () => {
    for (const q of ["a".repeat(500), `x${NUL}y`, `${ESC}[31m`]) {
      const res = await call(search, { user: owner, params: { orgId }, path: `/api/x?q=${encodeURIComponent(q)}` });
      expect(res.status).toBe(400);
    }
    const injection = await call(search, { user: owner, params: { orgId }, path: `/api/x?q=${encodeURIComponent("' OR 1=1 --")}` });
    expect(injection.status).toBe(200);
    expect(injection.body.results).toEqual([]);
    const wildcard = await call(search, { user: owner, params: { orgId }, path: `/api/x?q=${encodeURIComponent("%%")}` });
    expect(wildcard.body.results ?? []).toEqual([]);
  });
});
