import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const rpc = vi.fn();
const logEvent = vi.fn();
const snapshot = {
  order: { id: "o1", paid: false, account_id: "a1", stripe_refund_id: null },
  plan: { refunds: [], handBack: [] }, hold: null as string | null, holdId: "checkout-a",
};
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ restaurantId: "r1", email: "ana" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("@/lib/platform-fee", () => ({ refundFee: vi.fn() }));
vi.mock("@/lib/legacy-stock", () => ({ legacyStockDemand: async () => [] }));
vi.mock("@/lib/cancel-read", () => ({ readCancel: async () => snapshot }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
const { POST } = await import("@/app/api/orders/cancel/route");
const cancel = () => POST(new NextRequest("https://test/api/orders/cancel", {
  method: "POST", body: JSON.stringify({ id: "o1" }),
}));
beforeEach(() => { vi.clearAllMocks(); snapshot.hold = null; });
describe("cancellation and collection agree on the plan's state", () => {
  it("passes the unpaid snapshot so collection winning the lock refuses cancellation", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect((await cancel()).status).toBe(409);
    expect(rpc).toHaveBeenCalledWith("cancel_order", expect.objectContaining({
      p_expected_paid: false, p_expected_account: "a1", p_expected_hold: null, p_expected_checkout: "checkout-a",
    }));
    expect(logEvent).not.toHaveBeenCalled();
  });
  it("passes the hold read with the plan, rather than a fresh hold", async () => {
    snapshot.hold = "2026-10-01T12:00:00Z";
    rpc.mockResolvedValue({ data: false, error: null });
    await cancel();
    expect(rpc.mock.calls[0][1].p_expected_hold).toBe(snapshot.hold);
  });
  it("still logs an unpaid cancellation when its snapshot matches", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect((await cancel()).status).toBe(200);
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "cancelled" }));
  });
});
