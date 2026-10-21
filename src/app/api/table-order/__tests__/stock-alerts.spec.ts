import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ enabled: false, selected: "", notify: vi.fn(), reserve: vi.fn() }));
vi.mock("@/lib/api-guard", () => ({ actingStaff: async () => ({ restaurantId: "r", role: "owner", email: "owner" }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/plan-server", () => ({ tierIncludes: async () => true }));
vi.mock("@/lib/promotions-on-sale", () => ({ promotionsOnSale: async () => [] }));
vi.mock("@/lib/open-menus", () => ({ DEFAULT_TIME_ZONE: "America/Mexico_City", openMenuIds: () => ({ ids: [], closedNow: false }) }));
vi.mock("@/lib/verify-cart", () => ({ cartReferences: () => ({ ok: true, ids: ["dish"] }), verifyCart: ({ items }: { items: unknown[] }) => ({ ok: true, lines: items }) }));
vi.mock("@/lib/table-session", () => ({ openSession: async () => "s" }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/stock-service", () => ({ reserveStock: state.reserve, releaseStock: async () => {}, raiseStockNotifications: state.notify }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const result = () => ({ error: null, data: table === "restaurants"
    ? { id: "r", currency: "MXN", low_stock_alerts_enabled: state.enabled, low_stock_threshold: 2 }
    : table === "restaurant_tables" ? { id: "t", label: "1" } : table === "orders" ? { id: "o" } : [] });
  const q = { select: (columns: string) => { if (table === "restaurants") state.selected = columns; return q; },
    eq: () => q, in: () => q, insert: () => q, maybeSingle: async () => result(), single: async () => result(),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
  return q;
} }) }));
const { POST } = await import("../route");
beforeEach(() => { vi.clearAllMocks(); state.reserve.mockResolvedValue({ ok: true, reservationId: "res", low: [{ itemId: "dish", stock: 1, kind: "low_stock" }] }); });
it.each([false, true])("J18: waiter stock alerts respect the manager's preference (%s)", async enabled => {
  state.enabled = enabled;
  const response = await POST(new NextRequest("https://test/api/table-order", { method: "POST", body: JSON.stringify({ tableId: "t", items: [{ itemId: "dish", name: "Dish", price: 10, qty: 1 }] }) }));
  expect(response.status).toBe(200);
  expect(state.reserve).toHaveBeenCalledTimes(1);
  expect(state.notify).toHaveBeenCalledTimes(enabled ? 1 : 0);
  expect(state.selected).toContain("low_stock_alerts_enabled");
});
