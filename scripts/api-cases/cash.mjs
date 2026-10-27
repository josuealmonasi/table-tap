import { MARK } from "../api-fixtures.mjs";

export function cashCases(fx) {
  const { restaurant } = fx;
  const r = restaurant.id;
  return [
    // ── The cash drawer, a shift at a time ───────────────────────────────
    // A whole shift, in order: nothing can be taken out of a drawer nobody
    // opened; it opens with its cash; one open at a time; cash taken out of
    // it; closed by a blind, signed count; its difference explained once. The
    // people who run the drawer do it, only a manager strikes a withdrawal
    // off, and nobody else may touch any of it.
    { name: "POST /api/cash-drawer (no shift open: nothing to take out of)", as: "cashier", method: "POST",
      path: "/api/cash-drawer", body: { kind: "withdrawal", amount: 50 }, expect: [409],
      expectError: /turno abierto|shift is open/i },
    { name: "POST /api/cash-shift (the cashier opens a shift)", as: "cashier", method: "POST",
      path: "/api/cash-shift", body: { action: "open", amount: "1,250.50" }, expect: [200],
      check: async (d, f) => {
        const { data } = await f.admin.from("cash_shifts").select("opening_amount, opened_by, closed_at").eq("id", d.id).maybeSingle();
        return Number(data?.opening_amount) === 1250.5 && data?.opened_by === "demo-cashier@tabletap.dev" && data?.closed_at === null
          || `stored ${JSON.stringify(data)}`;
      } },
    { name: "POST /api/cash-shift (a second one while it is open)", as: "manager", method: "POST",
      path: "/api/cash-shift", body: { action: "open", amount: 100 }, expect: [409],
      expectError: /ya hay un turno|already open/i },
    { name: "POST /api/cash-drawer (a withdrawal, in the open shift)", as: "manager", method: "POST",
      path: "/api/cash-drawer", body: { kind: "withdrawal", amount: 120, note: `${MARK} supplier` }, expect: [200],
      save: d => ({ cashWithdrawal: d.id }),
      check: async (d, f) => {
        const [{ data: row }, { data: open }] = await Promise.all([
          f.admin.from("cash_movements").select("kind, amount, note, shift_id").eq("id", d.id).maybeSingle(),
          f.admin.from("cash_shifts").select("id").eq("restaurant_id", r).is("closed_at", null).maybeSingle(),
        ]);
        return row?.kind === "withdrawal" && Number(row.amount) === 120 && row.note === `${MARK} supplier` && row.shift_id === open?.id
          || `stored ${JSON.stringify(row)} in shift ${open?.id}`;
      } },
    { name: "POST /api/cash-drawer (a withdrawal of nothing)", as: "cashier", method: "POST",
      path: "/api/cash-drawer", body: { kind: "withdrawal", amount: "0" }, expect: [400],
      expectError: /cantidad de efectivo|amount of cash/i },
    { name: "POST /api/cash-drawer (a waiter refused)", as: "waiter", method: "POST",
      path: "/api/cash-drawer", body: { kind: "withdrawal", amount: 50 }, expect: [403] },
    { name: "POST /api/cash-shift (the kitchen refused)", as: "kitchen", method: "POST",
      path: "/api/cash-shift", body: { action: "open", amount: 50 }, expect: [403] },
    { name: "DELETE /api/cash-drawer (a cashier cannot strike off a withdrawal)", as: "cashier", method: "DELETE",
      path: "/api/cash-drawer", body: (_f, saved) => ({ id: saved.cashWithdrawal }), expect: [403] },
    { name: "DELETE /api/cash-drawer (a manager strikes it off)", as: "manager", method: "DELETE",
      path: "/api/cash-drawer", body: (_f, saved) => ({ id: saved.cashWithdrawal }), expect: [200],
      check: async (_d, f) => {
        const { count } = await f.admin.from("cash_movements").select("id", { count: "exact", head: true })
          .eq("note", `${MARK} supplier`);
        return count === 0 || "the withdrawal is still there";
      } },
    { name: "DELETE /api/cash-drawer (one that is not here)", as: "manager", method: "DELETE",
      path: "/api/cash-drawer", body: { id: "00000000-0000-4000-8000-000000000000" }, expect: [404],
      expectError: /ya no está|not here/i },
    { name: "POST /api/cash-shift (a close nobody signed off)", as: "cashier", method: "POST",
      path: "/api/cash-shift", body: { action: "close", counted: 1000 }, expect: [400],
      expectError: /contaste|counted/i },
    { name: "POST /api/cash-shift (closed on a blind count)", as: "cashier", method: "POST",
      path: "/api/cash-shift", body: async f => {
        const { data } = await f.admin.from("cash_shifts").select("id").eq("restaurant_id", r).is("closed_at", null).single();
        return { action: "close", shiftId: data.id, ref: crypto.randomUUID(), counted: "1000", confirm: true };
      }, expect: [200],
      save: d => ({ cashShift: d.id }),
      check: async (d, f) => {
        // What the drawer should have held: the opening, the cash taken while
        // it was open (none, in this run), the withdrawal struck off.
        const { data } = await f.admin.from("cash_shifts")
          .select("closed_by, counted_cash, expected_cash, difference").eq("id", d.id).maybeSingle();
        if (Number(d.expected) !== 1250.5) return `expected ${d.expected}, not 1250.50`;
        if (Number(d.difference) !== -250.5) return `a difference of ${d.difference}, not -250.50`;
        return data?.closed_by === "demo-cashier@tabletap.dev" && Number(data.counted_cash) === 1000
          && Number(data.expected_cash) === 1250.5 && Number(data.difference) === -250.5
          || `stored ${JSON.stringify(data)}`;
      } },
    { name: "POST /api/cash-drawer (nothing taken out of a closed shift)", as: "manager", method: "POST",
      path: "/api/cash-drawer", body: { kind: "withdrawal", amount: 10 }, expect: [409],
      expectError: /turno abierto|shift is open/i },
    { name: "POST /api/cash-shift (the closer explains the difference)", as: "cashier", method: "POST",
      path: "/api/cash-shift", body: (_f, saved) => ({ action: "explain", id: saved.cashShift, note: `${MARK} change` }),
      expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin.from("cash_shifts").select("difference_note, explained_by")
          .eq("restaurant_id", r).eq("difference_note", `${MARK} change`).maybeSingle();
        return data?.explained_by === "demo-cashier@tabletap.dev" || `stored ${JSON.stringify(data)}`;
      } },
    { name: "POST /api/cash-shift (an explanation is given once)", as: "manager", method: "POST",
      path: "/api/cash-shift", body: (_f, saved) => ({ action: "explain", id: saved.cashShift, note: "rewritten" }),
      expect: [409], expectError: /ya tiene explicación|already explained/i },
    { name: "POST /api/cash-shift (a waiter cannot explain one)", as: "waiter", method: "POST",
      path: "/api/cash-shift", body: (_f, saved) => ({ action: "explain", id: saved.cashShift, note: "x" }), expect: [403] },
  ];
}
