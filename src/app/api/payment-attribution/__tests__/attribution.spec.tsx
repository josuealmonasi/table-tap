import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const { rpc, filters } = vi.hoisted(() => ({ rpc: vi.fn(), filters: [] as unknown[][] }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ restaurantId: "tenant", email: "manager" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from: (table: string) => {
  const q = { select: () => q, eq: (...args: unknown[]) => { filters.push([table, ...args]); return q; },
    neq: (...args: unknown[]) => { filters.push([table, ...args]); return q; }, is: () => q, order: () => q,
    maybeSingle: async () => ({ data: { session_id: "s", allocation_origin: "legacy", currency: "MXN" }, error: null }),
    range: async () => ({ data: [], error: null }) };
  return q;
} }) }));
import { GET, POST } from "../route";
beforeEach(() => { filters.length = 0; rpc.mockReset().mockResolvedValue({ data: true, error: null }); });
const post = (body: unknown) => POST(new NextRequest("https://test/api/payment-attribution", { method: "POST", body: JSON.stringify(body) }));
describe("historical attribution evidence", () => {
  it("offers cancelled orders within the original tenant, sitting and known currency", async () => {
    expect((await GET(new NextRequest("https://test/api/payment-attribution?id=p"))).status).toBe(200);
    expect(filters).toEqual(expect.arrayContaining([["orders", "restaurant_id", "tenant"], ["orders", "currency", "MXN"], ["orders", "session_id", "s"]]));
    expect(filters).not.toContainEqual(["orders", "status", "cancelled"]);
  });
  it("requires evidence and forwards the manager's explicit currency and unknown-breakdown choice", async () => {
    const entries = [{ orderId: "cancelled", amount: 100, tip: 0 }];
    expect((await post({ paymentId: "p", entries })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect((await post({ paymentId: "p", entries, currency: "MXN", evidence: "receipt 123", breakdownUnknown: true })).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("attribute_payment", expect.objectContaining({ p_restaurant: "tenant", p_currency: "MXN", p_evidence: "receipt 123", p_breakdown_unknown: true }));
  });
});
