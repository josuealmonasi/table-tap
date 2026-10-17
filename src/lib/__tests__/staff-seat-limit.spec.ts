import { expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const deleteUser = vi.fn(async () => ({}));
vi.mock("@/lib/api-guard", () => ({ actingOwner: async () => ({ restaurantId: "r1", email: "owner@test.com" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number, vars: object) => NextResponse.json({ error, vars }, { status }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, seatBlocks: async () => null }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: {} }), allPlans: async () => [] }));
vi.mock("@/lib/user-log", () => ({ logUserChange: async () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  auth: { admin: { inviteUserByEmail: async () => ({ data: { user: { id: "u1" } }, error: null }), deleteUser } },
  from: () => {
    const q = { select: () => q, eq: () => q,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ count: 9, error: null }).then(resolve),
      insert: async () => ({ error: { message: "tt_plan_limit staff servicio 10" } }),
    }; return q;
  },
}) }));
const { POST } = await import("@/app/api/staff/route");
it("D6 rolls back an invite when another create took the last database seat", async () => {
  const response = await POST(new NextRequest("https://test/api", { method: "POST", body: JSON.stringify({ email: "waiter@test.com", role: "waiter" }) }));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: "plan.limit.staff", vars: { max: 10 } });
  expect(deleteUser).toHaveBeenCalledWith("u1");
});
