import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => ({ restaurantId: "r", email: "manager", role: "manager" }) }));
vi.mock("@/lib/plan-guard", () => ({ planBlocks: async () => null }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/coupon-service", () => ({
  findCoupon: async () => ({ id: "coupon", code: "HALF", kind: "percent", value: 50 }),
  couponProblem: () => null,
  toAppliedCoupon: (c: unknown) => c,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  const q = { select: () => q, is: () => q, eq: () => q,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: "order", total: 220 }], error: null }).then(resolve) };
  return q;
} }) }));
vi.mock("@/lib/checkout-page-rpc", () => ({ checkoutPageRpc: async () => ({ data: "changed", error: null }) }));
import { POST } from "@/app/api/bill/discount/route";
import { logEvent } from "@/lib/activity-log";

it("F1 explains a locked discount refusal in both languages without logging success", async () => {
  const response = await POST(new NextRequest("https://test/api/bill/discount", {
    method: "POST", body: JSON.stringify({ orderId: "order", code: "HALF" }),
  }));
  expect(response.status).toBe(409);
  const { error } = await response.json();
  expect(error, "changed is a stale quote, so the manager must be told to review the bill").toBe("apiErr.discountChanged");
  for (const language of [en, es]) expect((language.apiErr as Record<string, string>)[error.split(".")[1]]).toBeTruthy();
  expect(logEvent).not.toHaveBeenCalled();
});
