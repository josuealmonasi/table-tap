import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { admin, plan, rpc, audit } = vi.hoisted(() => ({ admin: vi.fn(), plan: vi.fn(), rpc: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/admin", () => ({ getPlatformAdmin: admin }));
vi.mock("@/lib/api-error", () => ({ apiError: async (key: string, status: number) => NextResponse.json({ error: key }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc, from: (table: string) => table === "plan_limits"
    ? { select: () => ({ eq: () => ({ maybeSingle: plan }) }) }
    : { insert: audit },
}) }));
const { POST } = await import("@/app/api/admin/plan-price-changes/route");
const future = () => new Date(Date.now() + 31 * 86400000).toISOString();
const request = (body: Record<string, unknown>) => new NextRequest("https://test/api/admin/plan-price-changes", {
  method: "POST", body: JSON.stringify({ plan: "casa", newPrice: 2500, effectiveAt: future(), ...body }),
});
beforeEach(() => {
  vi.clearAllMocks();
  admin.mockResolvedValue({ userId: "admin-1", email: "admin@example.test" });
  plan.mockResolvedValue({ data: { plan: "casa" }, error: null });
  audit.mockResolvedValue({ error: null });
  rpc.mockResolvedValue({ data: "change-1", error: null });
});
it("refuses dates less than 30 full days away", async () => {
  expect((await POST(request({ effectiveAt: new Date(Date.now() + 29 * 86400000).toISOString() }))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
it("refuses unknown plans", async () => {
  plan.mockResolvedValue({ data: null, error: null });
  expect((await POST(request({ plan: "missing" }))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
it.each([0, -1])("refuses non-positive price %s", async newPrice => {
  expect((await POST(request({ newPrice }))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
it("refuses anyone outside platform administration", async () => {
  admin.mockResolvedValue(null);
  expect((await POST(request({}))).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});
it("audits and schedules the change and notices in one RPC", async () => {
  const effectiveAt = future();
  expect((await POST(request({ effectiveAt }))).status).toBe(200);
  expect(rpc).toHaveBeenCalledWith("schedule_plan_price_change", {
    p_plan: "casa", p_price: 2500, p_effective_at: effectiveAt, p_created_by: "admin-1",
  });
  expect(audit).toHaveBeenCalledTimes(2);
});
