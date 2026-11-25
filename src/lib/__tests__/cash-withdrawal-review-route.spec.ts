import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";

// Cash withdrawals: approval, cap and retired references (2026-11-25).
// A cashier recorded MX$60 of missing cash as a "withdrawal" and closed with
// no difference; MX$250 came out of a MX$100 drawer; a late retry rewrote a
// withdrawal a manager had just removed.
const state = vi.hoisted(() => ({ rpc: vi.fn(), log: vi.fn(), role: "cashier", open: true, held: 0 }));
vi.mock("@/lib/api-guard", () => ({
  actingStaff: async () => ({ restaurantId: "r", email: `${state.role}@x`, role: state.role }),
  actingManager: async () => ["owner", "manager"].includes(state.role) ? { restaurantId: "r", email: `${state.role}@x`, role: state.role } : null,
}));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number, vars?: object) => Response.json({ error, vars }, { status }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: state.log }));
vi.mock("@/lib/held-cash", () => ({ heldCashWaiting: async () => state.held }));
vi.mock("@/lib/cash-shift-server", () => ({ openShift: async () => state.open ? { id: "shift" } : null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: state.rpc }) }));
const { POST, PATCH } = await import("@/app/api/cash-drawer/route");
const shiftRoute = await import("@/app/api/cash-shift/route");

const id = "00000000-0000-4000-8000-0000000000aa";
const ref = "00000000-0000-4000-8000-000000000001";
const shiftId = "00000000-0000-4000-8000-000000000002";
const withdraw = (body: object = {}) => POST(new NextRequest("https://test/api/cash-drawer", {
  method: "POST", body: JSON.stringify({ kind: "withdrawal", amount: "60", note: "cambio", ...body }),
}));
const review = (body: object) => PATCH(new NextRequest("https://test/api/cash-drawer", { method: "PATCH", body: JSON.stringify(body) }));
const answer = async (res: Response) => ({ status: res.status, body: await res.json() });
beforeEach(() => {
  state.role = "cashier"; state.open = true; state.held = 0;
  state.rpc.mockReset(); state.log.mockReset();
});

it("passes the signed-in role to the writer, and a cashier's withdrawal comes back pending", async () => {
  state.rpc.mockResolvedValue({ data: { id, currency: "MXN", status: "pending" }, error: null });
  expect(await answer(await withdraw())).toEqual({ status: 200, body: { ok: true, id, pending: true } });
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("create_cash_withdrawal", expect.objectContaining({ p_role: "cashier", p_actor: "cashier@x" }));
  expect(state.log).toHaveBeenCalledWith(expect.objectContaining({ entity: "cash", action: "requested" }));
});

it("a manager's withdrawal is recorded as before", async () => {
  state.role = "manager";
  state.rpc.mockResolvedValue({ data: { id, currency: "MXN", status: "approved" }, error: null });
  expect(await answer(await withdraw({ ref, shiftId }))).toEqual({ status: 200, body: { ok: true, id } });
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("create_cash_withdrawal_once", expect.objectContaining({ p_role: "manager", p_ref: ref }));
  expect(state.log).toHaveBeenCalledWith(expect.objectContaining({ action: "created" }));
});

it.each([false, true])("a withdrawal larger than the drawer is refused in words (retry %s)", async once => {
  state.role = "owner";
  state.rpc.mockResolvedValue({ data: null, error: { code: "PT422", message: "withdrawal exceeds the drawer" } });
  expect(await answer(await withdraw({ amount: "250", ...(once ? { ref, shiftId } : {}) })))
    .toEqual({ status: 409, body: { error: "apiErr.cashWithdrawalOverDrawer" } });
  expect(state.log).not.toHaveBeenCalled();
  for (const locale of ["es", "en"] as const) {
    expect(translate(messagesFor(locale), "apiErr.cashWithdrawalOverDrawer")).not.toBe("apiErr.cashWithdrawalOverDrawer");
  }
});

it("a retry of a withdrawal a manager removed answers with the removal and logs nothing", async () => {
  state.rpc.mockResolvedValue({ data: { id, currency: "MXN", outcome: "removed" }, error: null });
  expect(await answer(await withdraw({ ref, shiftId }))).toEqual({ status: 200, body: { ok: true, id, removed: true } });
  expect(state.log).not.toHaveBeenCalled();
});

it("a retry of a rejected withdrawal says so", async () => {
  state.rpc.mockResolvedValue({ data: { id, currency: "MXN", status: "rejected" }, error: null });
  expect((await answer(await withdraw({ ref, shiftId }))).body).toEqual({ ok: true, id, rejected: true });
});

it.each(["cashier", "waiter", "kitchen"])("a %s cannot approve or reject", async role => {
  state.role = role;
  expect((await review({ id, decision: "approve" })).status).toBe(403);
  expect(state.rpc).not.toHaveBeenCalled();
});

it.each([["approve", "approved"], ["reject", "rejected"]])("a manager can %s a pending withdrawal in the open shift", async (decision, stored) => {
  state.role = "manager";
  state.rpc.mockResolvedValue({ data: { id, status: stored, amount: 60, note: "cambio", currency: "MXN", actor: "cashier@x" }, error: null });
  expect(await answer(await review({ id, decision }))).toEqual({ status: 200, body: { ok: true, status: stored } });
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("review_cash_withdrawal", {
    p_restaurant: "r", p_shift: "shift", p_movement: id, p_actor: "manager@x", p_role: "manager", p_decision: stored,
  });
  expect(state.log).toHaveBeenCalledWith(expect.objectContaining({ entity: "cash", action: stored, operationKey: `withdrawal-review:${id}` }));
});

it.each([[{ id, decision: "approved" }], [{ id, decision: null }], [{ id: "x", decision: "approve" }], [{}]])("refuses a malformed review %j", async body => {
  state.role = "owner";
  expect((await review(body)).status).toBe(400);
  expect(state.rpc).not.toHaveBeenCalled();
});

it("an approval that no longer fits the drawer is refused", async () => {
  state.role = "manager";
  state.rpc.mockResolvedValue({ data: null, error: { code: "PT422" } });
  expect(await answer(await review({ id, decision: "approve" }))).toEqual({ status: 409, body: { error: "apiErr.cashWithdrawalOverDrawer" } });
  expect(state.log).not.toHaveBeenCalled();
});

it("a decision another manager already took is a conflict; the same one again logs nothing new", async () => {
  state.role = "manager";
  state.rpc.mockResolvedValue({ data: { outcome: "decided", status: "rejected" }, error: null });
  expect(await answer(await review({ id, decision: "approve" }))).toEqual({ status: 409, body: { error: "apiErr.cashWithdrawalDecided" } });
  state.rpc.mockResolvedValue({ data: { id, status: "approved", amount: 60, currency: "MXN", repeat: true }, error: null });
  expect((await review({ id, decision: "approve" })).status).toBe(200);
  expect(state.log).not.toHaveBeenCalled();
});

it("no open shift, or a withdrawal not in it, is not found", async () => {
  state.role = "manager"; state.open = false;
  expect((await review({ id, decision: "approve" })).status).toBe(404);
  state.open = true;
  state.rpc.mockResolvedValue({ data: null, error: null });
  expect((await review({ id, decision: "reject" })).status).toBe(404);
});

it.each([["cashier", "apiErr.shiftPendingWithdrawalsCashier"], ["manager", "apiErr.shiftPendingWithdrawals"]])(
  "the close refuses while a withdrawal awaits approval (%s)", async (role, key) => {
    state.role = role;
    state.rpc.mockResolvedValue({ data: { outcome: "pending_withdrawals", waiting: 2 }, error: null });
    const res = await shiftRoute.POST(new NextRequest("https://test/api/cash-shift", { method: "POST",
      body: JSON.stringify({ action: "close", shiftId, ref, counted: "40", confirm: true }) }));
    expect(await answer(res)).toEqual({ status: 409, body: { error: key, vars: { n: 2 } } });
    expect(state.log).not.toHaveBeenCalled();
    for (const locale of ["es", "en"] as const) expect(translate(messagesFor(locale), key, { n: 2 })).toContain("2");
  });
