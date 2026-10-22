import { beforeEach, expect, it, vi } from "vitest";
import type { CashShift } from "@/lib/cash-shift";

interface Row extends CashShift { currency: string }
const state = vi.hoisted(() => ({ rows: [] as Row[], currency: "USD", failed: false }));
const payment = { created_at: "2026-10-19T23:30:00Z", recorded_at: "2026-10-21T10:00:00Z", currency: "MXN" };
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: (name: string, args: Record<string, string>) => {
    let offset = 0;
    const q = {
      order: () => q, range: (n: number) => { offset = n; return q; },
      then: (resolve: (v: unknown) => unknown) => {
        const s = state.rows.find(s => s.id === args.p_shift)!;
        const receipts = [{ currency: "MXN", amount: 100 }, { currency: "USD", amount: 200 }];
        const returns = [{ currency: "MXN", amount: 10 }, { currency: "USD", amount: 50 }];
        const net = s ? receipts.filter(p => p.currency === s.currency).reduce((n, p) => n + p.amount, 0)
          - returns.filter(p => p.currency === s.currency).reduce((n, p) => n + p.amount, 0) : 0;
        const data = name === "cash_shift_totals"
          ? { opening: s.opening_amount, cashSales: net, withdrawn: 5, expected: s.opening_amount + net - 5 }
          : state.rows.filter(s => !s.closed_at || s.opened_at >= args.p_day_start || s.closed_at >= args.p_day_start ||
            (payment.recorded_at >= args.p_day_start && payment.created_at >= s.opened_at && payment.created_at <= s.closed_at && s.currency === payment.currency)).slice(offset);
        return Promise.resolve({ data: state.failed ? null : data, error: state.failed ? { message: "offline" } : null }).then(resolve);
      },
    };
    return q;
  },
  from: (table: string) => {
    let currency = ""; let or = ""; let offset = 0;
    const q: Record<string, unknown> = {};
    for (const key of ["select", "gte", "lte", "is", "order"]) q[key] = () => q;
    q.eq = (key: string, value: string) => { if (key === "currency") currency = value; return q; };
    q.or = (value: string) => { or = value; return q; };
    q.range = (n: number) => { offset = n; return q; };
    const result = () => {
      let data: unknown = [];
      if (table === "restaurants") data = { currency: state.currency };
      if (table === "payments" && offset === 0) data = [{ amount: currency === "MXN" ? 100 : 200, method: "cash", actor_email: "cashier" }];
      if (table === "refund_operations" && offset === 0) data = [{ amount: currency === "MXN" ? 10 : 50, source: "cash", payout_actor: "cashier" }];
      if (table === "cash_movements") data = [{ amount: 5 }];
      if (table === "cash_shifts") data = state.rows.filter(s => !s.closed_at || or.includes("closed_at.gte.") && s.closed_at >= "2026-10-21" || s.opened_at >= "2026-10-21");
      return { data, error: null };
    };
    q.single = async () => result();
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return q;
  },
}) }));
const { shiftSumOf, todaysShifts } = await import("@/lib/cash-shift-server");
const row = (id: string, opened_at: string, closed_at: string | null): Row => ({
  id, opened_at, closed_at, currency: "MXN", opening_amount: 20, opened_by: "cashier", closed_by: null,
  expected_cash: 20, counted_cash: 20, difference: 0, difference_note: null, explained_by: null,
});
beforeEach(() => { state.rows = []; state.currency = "USD"; state.failed = false; });
it("I2 sums receipts and returns in the shift currency after the restaurant switches currency", async () => {
  const shift = row("open", "2026-10-20T12:00:00Z", null); state.rows = [shift];
  expect(await shiftSumOf("r", shift)).toMatchObject({ cashSales: 90, expected: 105 });
});
it("keeps original-currency receipts and returns out of a current-currency drawer count", async () => {
  const shift = { ...row("usd", "2026-10-20T12:00:00Z", null), currency: "USD" }; state.rows = [shift];
  expect(await shiftSumOf("r", shift)).toMatchObject({ cashSales: 150, expected: 165 });
});
it("throws when the drawer sum cannot be read instead of showing a false exact count", async () => {
  const shift = row("open", "2026-10-20T12:00:00Z", null); state.rows = [shift]; state.failed = true;
  await expect(shiftSumOf("r", shift)).rejects.toThrow("offline");
});
it("I13 includes a shift opened yesterday and closed during the reporting day", async () => {
  state.rows = [row("overnight", "2026-10-20T22:00:00Z", "2026-10-21T02:00:00Z")];
  expect((await todaysShifts("r", new Date("2026-10-21T00:00:00Z"))).map(s => s.id)).toEqual(["overnight"]);
});
it("I13 brings an older closed shift back on the day its late receipt arrives", async () => {
  state.rows = [row("late", "2026-10-19T22:00:00Z", "2026-10-20T02:00:00Z")];
  expect((await todaysShifts("r", new Date("2026-10-21T00:00:00Z"))).map(s => s.id)).toEqual(["late"]);
});
it("I13 keeps unrelated older shifts out and returns a corrected shift only once", async () => {
  state.rows = [row("late", "2026-10-19T22:00:00Z", "2026-10-20T02:00:00Z"),
    row("other-window", "2026-10-19T12:00:00Z", "2026-10-19T16:00:00Z"),
    { ...row("other-currency", "2026-10-19T22:00:00Z", "2026-10-20T02:00:00Z"), currency: "USD" }];
  expect((await todaysShifts("r", new Date("2026-10-21T00:00:00Z"))).map(s => s.id)).toEqual(["late"]);
});
