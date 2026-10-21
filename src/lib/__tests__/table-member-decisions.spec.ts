import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { MEMBER_COOKIE, newMemberToken } from "@/lib/table-member-cookie";

const state = vi.hoisted(() => ({ role: "waiter", restaurant: "11111111-1111-1111-1111-111111111111", member: false, rpc: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ currentUser: async () => ({ email: "staff@test" }) }));
vi.mock("@/lib/membership", () => ({ getMembership: async () => ({ role: state.role, restaurant: { id: state.restaurant } }), MANAGES: () => false }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: async () => false, isRoomLimited: async () => false, isTableLimited: async () => false, clientKey: () => "test", PHONES_PER_ADDRESS: 160, forTheRoom: (n: number) => n }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/table-membership", () => ({ tableMember: async () => state.member ? { id: "member" } : null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: state.rpc }) }));
const { PATCH } = await import("@/app/api/table-membership/route");
const r = "11111111-1111-1111-1111-111111111111";
const t = "22222222-2222-2222-2222-222222222222";
const memberId = "33333333-3333-3333-3333-333333333333";
const token = newMemberToken();
const request = (approve = true) => new NextRequest("https://test/api/table-membership", {
  method: "PATCH", headers: { cookie: `${MEMBER_COOKIE}=${token}`, "content-type": "application/json" },
  body: JSON.stringify({ restaurantId: r, tableId: t, memberId, approve, role: "owner" }),
});
beforeEach(() => { state.role = "waiter"; state.restaurant = r; state.member = false; state.rpc.mockReset().mockResolvedValue({ data: true }); });

it.each(["owner", "manager", "cashier", "waiter"])("lets %s approve or reject through their restaurant-scoped server role", async role => {
  state.role = role;
  expect((await PATCH(request())).status).toBe(200);
  expect((await PATCH(request(false))).status).toBe(200);
  expect(state.rpc).toHaveBeenLastCalledWith("decide_table_member", expect.objectContaining({ p_approve: false, p_restaurant: r, p_table: t, p_staff: "staff@test", p_hash: null }));
});
it("never lets a kitchen login approve, even when the body claims owner", async () => {
  state.role = "kitchen";
  expect((await PATCH(request())).status).toBe(403);
  expect(state.rpc).not.toHaveBeenCalled();
});
it("refuses another restaurant's staff", async () => {
  state.restaurant = t;
  expect((await PATCH(request())).status).toBe(403);
  expect(state.rpc).not.toHaveBeenCalled();
});
it("lets an approved phone decide through its credential, without claiming a staff role", async () => {
  state.member = true;
  state.role = "kitchen";
  expect((await PATCH(request())).status).toBe(200);
  expect(state.rpc).toHaveBeenCalledWith("decide_table_member", expect.objectContaining({ p_member: memberId, p_staff: null, p_hash: expect.stringMatching(/^[0-9a-f]{64}$/) }));
});
it("does not report success for a decision on a closed or already-decided request", async () => {
  state.rpc.mockResolvedValueOnce({ data: false });
  expect((await PATCH(request())).status).toBe(409);
});

it("does not let a browser form replace a credential or make a decision", async () => {
  const { POST } = await import("@/app/api/table-membership/route");
  const form = () => new NextRequest("https://test/api/table-membership", {
    method: "POST", headers: { "content-type": "text/plain" },
    body: JSON.stringify({ restaurantId: r, tableId: t, memberId, approve: true }),
  });
  expect((await POST(form())).status).toBe(400);
  expect((await PATCH(form())).status).toBe(400);
  expect(state.rpc).not.toHaveBeenCalled();
});
