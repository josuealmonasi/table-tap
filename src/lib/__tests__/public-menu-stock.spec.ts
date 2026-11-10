import { beforeEach, expect, it, vi } from "vitest";
import type { OrderLineItem } from "@/lib/types";

const { rpc, invalidate, insert } = vi.hoisted(() => ({ rpc: vi.fn(), invalidate: vi.fn(), insert: vi.fn() }));
vi.mock("@/lib/public-menu-cache", () => ({ invalidatePublicMenu: invalidate }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from: () => ({ insert }) }) }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: { allows_inventory: true } }) }));
import { reserveStock, releaseStock, raiseStockNotifications } from "@/lib/stock-service";

beforeEach(() => { vi.clearAllMocks(); insert.mockResolvedValue({ error: null }); });

it("expires a last portion at reservation, even when nobody sends a stock notification", async () => {
  rpc.mockResolvedValue({ data: { ok: true, short: [], low: [{ item_id: "dish", stock: 0, kind: "out_of_stock", name: "Soup" }] } });
  await reserveStock("restaurant", [{ itemId: "dish", qty: 1 }] as OrderLineItem[], 5);
  expect(invalidate).toHaveBeenCalledWith("restaurant");
  expect(insert).not.toHaveBeenCalled();
});

it("expires stock returned after an abandoned reservation", async () => {
  rpc.mockResolvedValue({ error: null });
  await releaseStock("restaurant", "reservation");
  expect(invalidate).toHaveBeenCalledWith("restaurant");
});

it("expires a till sell-out before trying its optional bell notification", async () => {
  await raiseStockNotifications("restaurant", [{ itemId: "dish", stock: 0, kind: "out_of_stock", name: "Soup" }]);
  expect(invalidate).toHaveBeenCalledWith("restaurant");
  expect(invalidate.mock.invocationCallOrder[0]).toBeLessThan(insert.mock.invocationCallOrder[0]);
});

it("does not turn an ordinary low-stock warning into a restaurant cache miss", async () => {
  await raiseStockNotifications("restaurant", [{ itemId: "dish", stock: 2, kind: "low_stock", name: "Soup" }]);
  expect(invalidate).not.toHaveBeenCalled();
});
