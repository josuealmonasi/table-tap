import { expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const invite = vi.fn(async () => ({ data: { user: { id: "u1" } }, error: null }));
const deleteUser = vi.fn(async () => ({}));
vi.mock("@/lib/api-guard", () => ({ actingOwner: async () => ({ restaurantId: "r1", email: "owner@test.com" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number, vars: object) => NextResponse.json({ error, vars }, { status }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, seatBlocks: async () => null }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: {} }), allPlans: async () => [] }));
vi.mock("@/lib/user-log", () => ({ logUserChange: async () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  auth: { admin: { createUser: async () => ({ data: { user: { id: "u1" } }, error: null }), inviteUserByEmail: invite, deleteUser } },
  from: () => {
    const q = { select: () => q, eq: () => q,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ count: 9, error: null }).then(resolve),
      insert: async () => ({ error: { message: "tt_plan_limit staff servicio 10" } }),
    }; return q;
  },
}) }));
const { POST } = await import("@/app/api/staff/route");
it("D6 sends no invite when another create took the last database seat", async () => {
  const response = await POST(new NextRequest("https://test/api", { method: "POST", body: JSON.stringify({ email: "waiter@test.com", role: "waiter" }) }));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: "plan.limit.staff", vars: { max: 10 } });
  expect(invite).not.toHaveBeenCalled();
  expect(deleteUser).toHaveBeenCalledWith("u1");
});
