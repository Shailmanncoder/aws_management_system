import { describe, expect, it } from "vitest";
import { inventoryViewQuery, inventoryViewStorageKey, readInventoryViews } from "@/lib/inventory-views";

describe("inventory saved views", () => {
  it("preserves filters and ordering while dropping page and unrelated parameters", () => {
    const query = inventoryViewQuery("page=9&tag=env%3Dproduction&q=web&type=ec2&sort=name&dir=desc&region=us-east-1&account=account-a&redirect=https://example.com&pageSize=50");
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({ account: "account-a", region: "us-east-1", type: "ec2", q: "web", tag: "env=production", sort: "name", dir: "desc", pageSize: "50" });
    expect(inventoryViewQuery(query)).toBe(query);
  });

  it("isolates each user, workspace and inventory page", () => {
    const keys = [
      inventoryViewStorageKey("u1", "o1", "/resources"),
      inventoryViewStorageKey("u2", "o1", "/resources"),
      inventoryViewStorageKey("u1", "o2", "/resources"),
      inventoryViewStorageKey("u1", "o1", "/cloud/ec2"),
    ];
    expect(new Set(keys).size).toBe(4);
  });

  it("recovers safely from malformed or manipulated browser storage", () => {
    for (const raw of [null, "invalid", "{}", "null"]) expect(readInventoryViews(raw)).toEqual([]);
    expect(readInventoryViews(JSON.stringify([
      null, { id: 1 }, { id: "bad", name: " ", query: "" },
      { id: "valid", name: " Production ", query: "q=api&page=8&redirect=javascript:alert(1)" },
      { id: "valid", name: "Duplicate", query: "" },
    ]))).toEqual([{ id: "valid", name: "Production", query: "q=api" }]);
  });

  it("bounds stored views and parameter lengths", () => {
    const raw = JSON.stringify(Array.from({ length: 25 }, (_, i) => ({ id: String(i), name: `View ${i}`, query: "" })));
    expect(readInventoryViews(raw)).toHaveLength(20);
    expect(inventoryViewQuery(`q=${"x".repeat(513)}`)).toBe("");
  });
});
