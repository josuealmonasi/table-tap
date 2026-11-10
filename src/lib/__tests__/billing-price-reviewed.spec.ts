import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const s = vi.hoisted(() => ({ taken: 49, start: vi.fn() }));
vi.mock("@/lib/api-guard", () => ({ actingOwner: async () => ({ restaurantId: "r1", email: "owner@x" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/plan-server", () => ({ foundersTaken: async () => s.taken,
  allPlans: async () => [{ plan: "casa" }, { plan: "servicio" }] }));
vi.mock("@/lib/plan", async original => ({ ...await original<typeof import("@/lib/plan")>(), isSelfServe: () => true, readPlanName: (v: unknown) => v }));
vi.mock("@/lib/billing-checkout", () => ({ startRestaurantBilling: s.start }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
const { POST } = await import("@/app/api/billing/checkout/route");
const send = (body: object) => POST(new NextRequest("https://test/api/billing/checkout", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => { s.start.mockReset().mockResolvedValue({ url: "https://checkout" }); });

it("refuses a tier chosen at a price the page no longer shows (E3)", async () => {
  s.taken = 50;
  const res = await send({ plan: "casa", founding: true });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "apiErr.billingPriceChanged" });
  expect(s.start).not.toHaveBeenCalled();
});

it("goes ahead at the price that was shown", async () => {
  s.taken = 49;
  expect((await send({ plan: "casa", founding: true })).status).toBe(200);
  s.taken = 50;
  expect((await send({ plan: "casa", founding: false })).status).toBe(200);
  expect(s.start).toHaveBeenCalledTimes(2);
});
