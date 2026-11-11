import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn(), role: "cashier", open: true }));
vi.mock("@/lib/api-guard", () => ({
  actingStaff: async () => ({ restaurantId: "r", email: "cashier", role: state.role }),
  actingManager: async () => null,
}));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/cash-shift-server", () => ({ openShift: async () => state.open ? { id: "shift" } : null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: state.rpc }) }));
const { POST } = await import("@/app/api/cash-drawer/route");
const ref = "00000000-0000-4000-8000-000000000001";
const shiftId = "00000000-0000-4000-8000-000000000002";
const send = (body: object) => POST(new NextRequest("https://test/api/cash-drawer", {
  method: "POST", body: JSON.stringify({ kind: "withdrawal", amount: "25.50", note: " Staff ", ...body }),
}));
beforeEach(() => {
  state.role = "cashier"; state.open = true;
  state.rpc.mockReset().mockResolvedValue({ data: { id: "movement", currency: "MXN" }, error: null });
});

for (const once of [false, true]) {
  const retry = once ? { ref, shiftId } : {};
  it.each([undefined, "other", "tips"])(`passes purpose %s to the ${once ? "retry" : "legacy"} writer`, async purpose => {
    const res = await send({ ...retry, purpose });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "movement" });
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith(once ? "create_cash_withdrawal_once" : "create_cash_withdrawal", {
      ...(once ? { p_ref: ref } : {}), p_restaurant: "r", p_shift: once ? shiftId : "shift",
      p_amount: 25.5, p_note: "Staff", p_actor: "cashier", p_purpose: purpose ?? "other",
    });
  });
  it.each([null, "", "TIPs", "supplier", " tips ", 0, true, [], {}, ["tips"]])(
    `rejects invalid purpose %j before the ${once ? "retry" : "legacy"} writer`, async purpose => {
      expect((await send({ ...retry, purpose })).status).toBe(400);
      expect(state.rpc).not.toHaveBeenCalled();
    });
}
it("still requires a drawer actor for tips paid out", async () => {
  state.role = "kitchen";
  expect((await send({ purpose: "tips" })).status).toBe(403);
  expect(state.rpc).not.toHaveBeenCalled();
});
it("still requires an open shift for tips paid out", async () => {
  state.open = false;
  expect((await send({ purpose: "tips" })).status).toBe(409);
  expect(state.rpc).not.toHaveBeenCalled();
});
it("returns the writer's conflict when a retry changes its purpose", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { code: "PT409" } });
  expect((await send({ purpose: "tips", ref, shiftId })).status).toBe(409);
});
