import { beforeEach, expect, it, vi } from "vitest";
import type { CashShift } from "@/lib/cash-shift";

const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: state.rpc }) }));
const { shiftSumOf } = await import("@/lib/cash-shift-server");
const shift = { id: "shift" } as CashShift;
const until = new Date("2026-11-11T16:00:00Z");
beforeEach(() => state.rpc.mockReset());

it("keeps both tip totals from the RPC without recalculating expected cash", async () => {
  state.rpc.mockResolvedValue({ data: {
    opening: "20.00", cashSales: "110.00", tips: "10.00", tips_out: "8.50", withdrawn: "15.00", expected: "115.00",
  }, error: null });
  expect(await shiftSumOf("r", shift, until)).toEqual({
    opening: 20, cashSales: 110, tips: 10, tips_out: 8.5, withdrawn: 15, expected: 115,
    unclassifiedCash: 0, unclassifiedCashByCurrency: {},
  });
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("cash_shift_totals", {
    p_restaurant: "r", p_shift: "shift", p_until: until.toISOString(),
  });
});
it("defaults absent tip totals to zero for older RPC results", async () => {
  state.rpc.mockResolvedValue({ data: { opening: 20, cashSales: 110, withdrawn: 15, expected: 115 }, error: null });
  expect(await shiftSumOf("r", shift, until)).toMatchObject({ tips: 0, tips_out: 0, expected: 115 });
});
