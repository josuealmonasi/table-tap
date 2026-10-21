import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const writes: Record<string, unknown>[] = [];
let foundTable: { id: string; label: string } | null = { id: "t7", label: "7" };
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const query = {
        select: () => query, eq: () => query,
        insert: (row: Record<string, unknown>) => { writes.push(row); return query; },
        maybeSingle: async () => ({ data: foundTable, error: null }),
        single: async () => ({ data: table === "restaurants" ? {
          id: "r", accepting_orders: true, currency: "MXN", service_pct: 0,
          service_enabled: false, allow_pay_later: true,
        } : { id: "order" }, error: null }),
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: { allows_deferred_payment: true } }) }));
vi.mock("@/lib/plan", () => ({ can: () => true }));
vi.mock("@/lib/table-member-cookie", () => ({ memberHash: () => "hash" }));
vi.mock("@/lib/table-membership", () => ({ requestTableMember: async () => ({ status: "approved", sessionId: "s", diner: "member" }) }));
vi.mock("@/lib/promotions-on-sale", () => ({ promotionsOnSale: async () => [] }));
vi.mock("@/lib/checkout/orderable-now", () => ({ orderableNow: async () => ({ closedNow: false, onOpenMenu: () => true }) }));
vi.mock("@/lib/checkout/verified-lines", () => ({ verifiedLines: async () => ({ ok: true, lines: [] }) }));
vi.mock("@/lib/checkout/claim-coupon", () => ({ claimCheckoutCoupon: async () => ({ coupon: null }), logCheckoutCoupon: async () => {} }));
vi.mock("@/lib/checkout/app-fee", () => ({ checkoutFee: async () => ({ id: null, cents: 0 }) }));
vi.mock("@/lib/stock-service", () => ({
  reserveStock: async () => ({ ok: true, reservationId: "stock", low: [] }),
  releaseStock: async () => {}, raiseStockNotifications: async () => {},
}));
vi.mock("@/lib/checkout/card-session", () => ({ openCardSession: vi.fn() }));
const { POST } = await import("@/app/api/checkout/route");
const post = (tableId: string | null, tableLabel: unknown) => POST(new NextRequest("https://test/api/checkout", {
  method: "POST", body: JSON.stringify({ restaurantId: "r", tableId, tableLabel, items: [{}], payLater: true }),
}));
beforeEach(() => { writes.length = 0; foundTable = { id: "t7", label: "7" }; });

describe("G4: the destination comes from the validated table", () => {
  it("stores table 7 even when the diner calls it table 8", async () => {
    expect((await post("t7", "8")).status).toBe(200);
    expect(writes[0]).toMatchObject({ table_id: "t7", table_label: "7" });
  });
  it("ignores a forged label on a counter order", async () => {
    expect((await post(null, { toString: "x" })).status).toBe(200);
    expect(writes[0]).toMatchObject({ table_id: null, table_label: null });
  });
  it("still refuses an unknown or foreign table before writing", async () => {
    foundTable = null;
    expect((await post("other", "7")).status).toBe(404);
    expect(writes).toEqual([]);
  });
});
