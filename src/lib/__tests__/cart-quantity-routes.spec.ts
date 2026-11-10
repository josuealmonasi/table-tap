import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { en } from "@/lib/i18n/en";
import { translate } from "@/lib/i18n";

const writes = vi.hoisted(() => vi.fn());
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("@/lib/api-error", () => ({ apiError: async (key: string, status: number) =>
  NextResponse.json({ error: translate(en, key) }, { status }) }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/api-guard", () => ({ actingStaff: async () => ({ restaurantId: "r", role: "owner", email: "owner@example.com" }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: {} }) }));
vi.mock("@/lib/plan", () => ({ can: () => true }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false }));
vi.mock("@/lib/table-member-cookie", () => ({ memberHash: () => "hash" }));
vi.mock("@/lib/table-membership", () => ({ requestTableMember: async () => ({ status: "approved", sessionId: "s", diner: "me" }) }));
vi.mock("@/lib/table-guard", () => ({ tableOf: async () => ({ id: "00000000-0000-4000-8000-000000000001", label: "1" }) }));
vi.mock("@/lib/checkout/orderable-now", () => ({ orderableNow: async () => ({ closedNow: false, onOpenMenu: () => true }) }));
vi.mock("@/lib/promotions-on-sale", () => ({ promotionsOnSale: async () => [] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: writes, from: (table: string) => {
  const data = table === "restaurants" ? { id: "r", accepting_orders: true, allow_pay_later: true,
    stripe_account_id: "acct", stripe_charges_enabled: true, currency: "MXN" }
    : table === "restaurant_tables" ? { id: "00000000-0000-4000-8000-000000000001", label: "1" }
      : table === "menu_items" ? [{ id: "dish", name: "Dish", price: 20, available: true, modifiers: [] }] : null;
  const query = {
    select: () => query, eq: () => query, in: () => query, insert: writes, update: writes,
    single: async () => ({ data, error: null }), maybeSingle: async () => ({ data, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
  };
  return query;
} }) }));
import { POST as checkout } from "@/app/api/checkout/route";
import { POST as tableOrder } from "@/app/api/table-order/route";
import { POST as posOrder } from "@/app/api/pos/order/route";

beforeEach(() => writes.mockClear());
describe.each([["checkout", checkout], ["table-order", tableOrder], ["pos/order", posOrder]] as const)("L1: /api/%s", (path, post) => {
  it.each([-1, 0, 1.5, 1_000_000, "2"])("returns orderData 400 and writes nothing for quantity %s", async qty => {
    const response = await post(new NextRequest(`https://test/api/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        restaurantId: "r", tableId: "00000000-0000-4000-8000-000000000001", payLater: true,
        posRef: "00000000-0000-4000-8000-000000000002", method: "cash",
        items: [{ itemId: "dish", name: "Dish", price: 20, qty, mods: {} }],
      }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: en.apiErr.orderData });
    expect(writes).not.toHaveBeenCalled();
  });
});
