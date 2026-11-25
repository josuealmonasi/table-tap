import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({ waiting: 1, role: "cashier", rpc: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/held-cash", () => ({ heldCashWaiting: async () => s.waiting }));
vi.mock("@/lib/api-guard", () => ({
  actingStaff: async () => ({ restaurantId: "r", email: s.role, role: s.role }),
  actingManager: async () => ({ restaurantId: "r", email: "manager", role: "manager" }),
}));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: s.log }));
vi.mock("@/lib/cash-shift-server", () => ({ openShift: async () => null, shiftSumOf: async () => null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: s.rpc, from: vi.fn() }) }));
const { POST } = await import("@/app/api/cash-shift/route");
const close = () => POST(new NextRequest("https://test/api/cash-shift", { method: "POST", body: JSON.stringify({
  action: "close", shiftId: "00000000-0000-4000-8000-000000000005", ref: "00000000-0000-4000-8000-000000000006", counted: 100, confirm: true,
}) }));
beforeEach(() => { s.waiting = 1; s.role = "cashier"; s.rpc.mockReset(); s.log.mockReset(); });

it("does not sign a drawer while offline cash waits for a manager's review (C4)", async () => {
  s.rpc.mockResolvedValue({ data: { outcome: "held_cash", waiting: 1 }, error: null });
  const res = await close();
  expect(res.status).toBe(409);
  // A cashier cannot open the review: told to call a manager (full review, screens #1).
  expect(await res.json()).toEqual({ error: "apiErr.shiftHeldCashCashier" });
  expect(s.log).not.toHaveBeenCalled();
});

it("bl39 #6: a close retry gets its signed result even though cash was queued since", async () => {
  // The first close signed the count and its reply was lost; a held cash
  // receipt was queued afterwards. The retry must reach the RPC, which answers
  // with the saved close before it looks at the queue.
  s.waiting = 1;
  s.rpc.mockResolvedValue({ data: { id: "00000000-0000-4000-8000-000000000005", counted: 100, expected: 100, difference: 0, currency: "MXN" }, error: null });
  const res = await close();
  expect(res.status).toBe(200);
  expect((await res.json()).ok).toBe(true);
  expect(s.rpc).toHaveBeenCalledWith("close_cash_shift_once", expect.objectContaining({ p_ref: "00000000-0000-4000-8000-000000000006" }));
});

it.each(["manager", "owner"])("a %s is sent to review the held sales themselves", async role => {
  s.role = role;
  s.rpc.mockResolvedValue({ data: { outcome: "held_cash", waiting: 2 }, error: null });
  expect(await (await close()).json()).toEqual({ error: "apiErr.shiftHeldCash" });
});

it("the saved close is answered before the held-cash check, which lives in SQL", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  const once = sql.split("create or replace function public.close_cash_shift_once(")[1]!.split("$$;")[0]!;
  expect(once.indexOf("return s.close_result")).toBeGreaterThan(-1);
  expect(once.indexOf("return s.close_result")).toBeLessThan(once.indexOf("public.close_cash_shift("));
  expect(readFileSync("src/app/api/cash-shift/route.ts", "utf8")).not.toContain("heldCashWaiting");
});
