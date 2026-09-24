// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryViews } from "@/components/data/inventory-views";
import { FilterBar } from "@/components/data/filter-bar";
import { inventoryViewStorageKey } from "@/lib/inventory-views";

const navigation = vi.hoisted(() => ({ query: "q=web&tag=env%3Dprod&page=3", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/resources",
  useSearchParams: () => new URLSearchParams(navigation.query),
  useRouter: () => ({ replace: navigation.replace }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    clear: () => entries.clear(),
  }); navigation.query = "q=web&tag=env%3Dprod&page=3"; navigation.replace.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("saved inventory view controls", () => {
  it("saves, restores after remount, and removes a named view", async () => {
    const first = render(<InventoryViews userId="user" orgId="org" />);
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), { target: { value: "Production" } });
    fireEvent.submit(screen.getByRole("textbox", { name: "View name" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("link", { name: "Production" }).getAttribute("href")).toBe("/resources?q=web&tag=env%3Dprod"));
    first.unmount();
    render(<InventoryViews userId="user" orgId="org" />);
    expect(screen.getByRole("link", { name: "Production" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove saved view Production" }));
    expect(screen.queryByRole("link", { name: "Production" })).toBeNull();
  });

  it("does not carry another workspace's views across workspace changes", () => {
    window.localStorage.setItem(inventoryViewStorageKey("user", "org", "/resources"), JSON.stringify([{ id: "1", name: "Private view", query: "q=web" }]));
    const page = render(<InventoryViews userId="user" orgId="org" />);
    expect(screen.getByRole("link", { name: "Private view" })).toBeTruthy();
    page.rerender(<InventoryViews userId="user" orgId="another-org" />);
    expect(screen.queryByRole("link", { name: "Private view" })).toBeNull();
  });

  it("updates visible search and tag inputs when a saved URL is opened", async () => {
    const page = render(<FilterBar />);
    const input = screen.getByRole("textbox", { name: "Search" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "unfinished search" } });
    navigation.query = "q=database&tag=team%3Dfinance";
    page.rerender(<FilterBar />);
    expect(input.value).toBe("database");
    expect((screen.getByRole("textbox", { name: "Filter by tag (key or key=value)" }) as HTMLInputElement).value).toBe("team=finance");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
