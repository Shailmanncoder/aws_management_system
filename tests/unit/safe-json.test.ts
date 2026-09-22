import { describe, expect, it } from "vitest";
import { parseJsonSafely, readJsonBody } from "@/server/http/safe-json";

const req = (body: string, type = "application/json") =>
  new Request("http://localhost/api", { method: "POST", body, headers: { "content-type": type } });

describe("safe JSON parsing", () => {
  it("rejects prototype pollution keys", () => {
    expect(() => parseJsonSafely('{"__proto__":{"admin":true}}')).toThrow(/forbidden/);
    expect(() => parseJsonSafely('{"a":{"constructor":{"prototype":{}}}}')).toThrow(/forbidden/);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });

  it("rejects non-JSON content types (CSRF form posts)", async () => {
    await expect(readJsonBody(req("name=x", "application/x-www-form-urlencoded"))).rejects.toThrow(/Content-Type/);
  });

  it("enforces the size limit", async () => {
    await expect(readJsonBody(req(JSON.stringify({ a: "x".repeat(2000) })), 1000)).rejects.toThrow(/too large/);
  });

  it("parses valid JSON", async () => {
    await expect(readJsonBody(req('{"name":"ok"}'))).resolves.toEqual({ name: "ok" });
  });
});
