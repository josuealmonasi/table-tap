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
  const res = await close();
  expect(res.status).toBe(409);
  // A cashier cannot open the review: told to call a manager (full review, screens #1).
  expect(await res.json()).toEqual({ error: "apiErr.shiftHeldCashCashier" });
  expect(s.rpc).not.toHaveBeenCalled();
});

it("F2: returns the held-cash refusal if cash arrives after the preflight read", async () => {
  s.waiting = 0;
  s.rpc.mockResolvedValue({ data: { outcome: "held_cash", waiting: 1 }, error: null });
  const res = await close();
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "apiErr.shiftHeldCashCashier" });
  expect(s.log).not.toHaveBeenCalled();
});

it.each(["manager", "owner"])("a %s is sent to review the held sales themselves", async role => {
  s.role = role;
  const res = await close();
  expect(await res.json()).toEqual({ error: "apiErr.shiftHeldCash" });
  s.waiting = 0; s.rpc.mockResolvedValue({ data: { outcome: "held_cash", waiting: 2 }, error: null });
  expect(await (await close()).json()).toEqual({ error: "apiErr.shiftHeldCash" });
});
