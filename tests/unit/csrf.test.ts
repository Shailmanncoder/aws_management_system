import { describe, expect, it } from "vitest";
import { assertSameOrigin } from "@/server/http/csrf";

const APP = "http://localhost:3000";
const r = (method: string, headers: Record<string, string>) => new Request(`${APP}/api/x`, { method, headers });

describe("CSRF origin check", () => {
  it("allows safe methods", () => expect(() => assertSameOrigin(r("GET", {}), APP)).not.toThrow());
  it("allows same-origin POST", () => expect(() => assertSameOrigin(r("POST", { origin: APP }), APP)).not.toThrow());
  it("rejects cross-origin POST", () => expect(() => assertSameOrigin(r("POST", { origin: "https://evil.example" }), APP)).toThrow());
  it("rejects look-alike origins", () => expect(() => assertSameOrigin(r("POST", { origin: "http://localhost:3000.evil.example" }), APP)).toThrow());
  it("rejects missing origin without same-origin fetch metadata", () => expect(() => assertSameOrigin(r("DELETE", {}), APP)).toThrow());
  it("accepts Sec-Fetch-Site same-origin", () => expect(() => assertSameOrigin(r("PATCH", { "sec-fetch-site": "same-origin" }), APP)).not.toThrow());
});
