import { beforeEach, expect, it, vi } from "vitest";
import type { QueuedOfflineSale } from "@/lib/offline-review";
const state = vi.hoisted(() => ({ missing: false, failed: false, restaurantCurrency: "MXN", restaurants: [] as string[], menu: [] as string[] }));
vi.mock("@/lib/promotions-on-sale", () => ({ promotionsOnSale: async () => [] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const q: Record<string, unknown> = {};
  for (const key of ["select", "in"]) q[key] = () => q;
  q.eq = (key: string, value: string) => { if (table === "restaurants" && key === "id") state.restaurants.push(value); if (table === "menu_items" && key === "restaurant_id") state.menu.push(value); return q; };
  const result = () => ({ data: table === "restaurants" ? { currency: state.restaurantCurrency, service_pct: 10, service_enabled: true }
    : state.missing ? [] : [{ id: "dish", name: "Dish", emoji: "", price: 100, available: false, discount_pct: 0, modifiers: null, category_id: null }],
    error: state.failed ? { message: "offline" } : null });
  q.single = async () => result();
  q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return q;
} }) }));
const { createAdminClient } = await import("@/lib/supabase/admin");
const { compareOfflineSale } = await import("@/lib/offline-comparison");
const sale: QueuedOfflineSale = { pos_ref: "sale", collector: "cashier@example.com", currency: "MXN", submitted_by: "cashier@example.com",
  reason: "apiErr.offlineApproval", approved_by: null, approved_at: null, body: { method: "cash", tipAmount: 5,
    items: [{ itemId: "dish", name: "Dish", emoji: "", price: 80, qty: 1, mods: {} }],
    offline: { at: "2026-10-20T12:00:00Z", subtotal: 80, serviceFee: 8, tip: 5, discount: 0, total: 93 } } };
beforeEach(() => { state.missing = false; state.failed = false; state.restaurantCurrency = "MXN"; state.restaurants = []; state.menu = []; });
it("compares the stored receipt against server menu prices and service, including sold-out dishes", async () => {
  const before = JSON.stringify(sale);
  const comparison = await compareOfflineSale(createAdminClient(), "r", sale);
  expect(comparison).toMatchObject({ currency: "MXN", charge: { subtotal: 100, serviceFee: 10, tip: 5, total: 115 }, difference: -22 });
  expect(comparison?.lines[0].price).toBe(100);
  expect(state.restaurants).toEqual(["r"]); expect(state.menu).toEqual(["r"]);
  expect(JSON.stringify(sale)).toBe(before);
});
it("reports no comparison for missing products, failed reads, unknown currency or different currencies", async () => {
  state.missing = true;
  expect(await compareOfflineSale(createAdminClient(), "r", sale)).toBeNull();
  state.missing = false; state.failed = true;
  expect(await compareOfflineSale(createAdminClient(), "r", sale)).toBeNull();
  state.failed = false;
  expect(await compareOfflineSale(createAdminClient(), "r", { ...sale, currency: null })).toBeNull();
  state.restaurantCurrency = "USD";
  expect(await compareOfflineSale(createAdminClient(), "r", sale)).toBeNull();
});
