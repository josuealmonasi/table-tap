import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { messagesFor, translate } from "@/lib/i18n";
const state = vi.hoisted(() => ({ rpc: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ restaurantId: "restaurant", email: "manager" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/cash-shift-server", () => ({ openShift: async () => ({ id: "shift" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: state.rpc }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: state.log }));
import { DELETE } from "@/app/api/cash-drawer/route";
const id = "33333333-3333-4333-8333-333333333333";
const remove = () => DELETE(new NextRequest("http://localhost/api/cash-drawer", { method: "DELETE", body: JSON.stringify({ id }) }));
beforeEach(() => { state.rpc.mockReset(); state.log.mockReset(); });
it("returns linked as a 409 and never logs a deletion", async () => {
  state.rpc.mockResolvedValue({ data: { outcome: "linked" }, error: null });
  const response = await remove();
  expect({ status: response.status, body: await response.json() }).toEqual({ status: 409, body: { error: "apiErr.cashWithdrawalLinked" } });
  expect(state.rpc.mock.calls).toEqual([["delete_cash_withdrawal", { p_restaurant: "restaurant", p_shift: "shift", p_movement: id }]]);
  expect(state.log).not.toHaveBeenCalled();
  for (const locale of ["es", "en"] as const) expect(translate(messagesFor(locale), "apiErr.cashWithdrawalLinked")).not.toBe("apiErr.cashWithdrawalLinked");
});
it("still logs an ordinary successful deletion", async () => {
  state.rpc.mockResolvedValue({ data: { id, amount: 10, currency: "MXN", note: "Mistake" }, error: null });
  expect((await remove()).status).toBe(200); expect(state.log).toHaveBeenCalledOnce();
});
