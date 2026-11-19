import { MARK } from "../api-fixtures.mjs";
import { ask, checked } from "../api-retry-fixture.mjs";

// These cases follow the ordinary shift's close. Each owns its shift and rows,
// including any erroneous writes made by a refused request.
export function tipsOutCases(fx) {
  const r = fx.restaurant.id;
  const totals = (f, state) => checked(f.admin.rpc("cash_shift_totals", {
    p_restaurant: r, p_shift: state.shift, p_until: new Date().toISOString(),
  }));
  const rows = (f, state) => checked(f.admin.from("cash_movements")
    .select("id, amount, purpose, request_ref, shift_id").eq("restaurant_id", r).eq("shift_id", state.shift));
  const count = async (f, state) => {
    const { count, error } = await f.admin.from("cash_movements").select("id", { count: "exact", head: true })
      .eq("restaurant_id", r).eq("shift_id", state.shift);
    if (error) throw new Error(error.message);
    if (count === null) throw new Error("withdrawal count is missing");
    return count;
  };
  const body = (state, purpose) => ({ kind: "withdrawal", amount: 8.5, note: state.note,
    ...(purpose === undefined ? {} : { purpose }) });
  const arrange = state => async f => {
    state.shift = crypto.randomUUID();
    state.ref = crypto.randomUUID();
    state.note = `${MARK} tips-out ${state.ref}`;
    const cleanup = async () => {
      try {
        // logDetail replaces spaces with underscores; the UUID stays unchanged.
        await checked(f.admin.from("user_logs").delete().eq("restaurant_id", r).eq("entity", "cash")
          .like("detail", `%${state.ref}%`));
      } finally {
        try { await checked(f.admin.from("cash_movements").delete().eq("restaurant_id", r).eq("shift_id", state.shift)); }
        finally { await checked(f.admin.from("cash_shifts").delete().eq("restaurant_id", r).eq("id", state.shift)); }
      }
    };
    try {
      const open = await checked(f.admin.from("cash_shifts").select("id")
        .eq("restaurant_id", r).is("closed_at", null).maybeSingle());
      if (open) throw new Error("tips-out case requires the ordinary shift chain to have closed");
      await checked(f.admin.from("cash_shifts").insert({ id: state.shift, restaurant_id: r,
        opening_amount: 100, opened_by: MARK, currency: fx.restaurant.currency }));
      state.before = await totals(f, state);
      state.countBefore = await count(f, state);
      return cleanup;
    } catch (error) { await cleanup(); throw error; }
  };
  const base = state => ({ as: "manager", method: "POST", path: "/api/cash-drawer", arrange: arrange(state) });
  const tips = {}, omitted = {}, invalid = {}, replay = {}, expected = {};
  return [
    { ...base(tips), name: "POST /api/cash-drawer (tips purpose is stored and totalled)",
      body: () => body(tips, "tips"), expect: [200],
      check: async (d, f) => {
        const stored = await rows(f, tips), after = await totals(f, tips);
        return stored.length === 1 && stored[0].id === d.id && stored[0].purpose === "tips"
          && Number(stored[0].amount) === 8.5 && Number(after.tips_out) === 8.5
          && Number(after.withdrawn) === Number(tips.before.withdrawn) + 8.5
          || `stored ${JSON.stringify(stored)}, totals ${JSON.stringify(after)}`;
      } },
    { ...base(omitted), name: "POST /api/cash-drawer (omitted purpose is stored as other)",
      body: () => body(omitted), expect: [200],
      check: async (d, f) => {
        const stored = await rows(f, omitted);
        return stored.length === 1 && stored[0].id === d.id && stored[0].purpose === "other"
          && Number(stored[0].amount) === 8.5 || `stored ${JSON.stringify(stored)}`;
      } },
    { ...base(invalid), name: "POST /api/cash-drawer (bonus purpose is refused without a write)",
      body: () => body(invalid, "bonus"), expect: [400], expectError: /invalid request|solicitud inválida/i,
      effect: async f => {
        const after = await count(f, invalid);
        return after === invalid.countBefore || `withdrawals changed from ${invalid.countBefore} to ${after}`;
      } },
    { ...base(replay), name: "POST /api/cash-drawer (changed-purpose replay conflicts and leaves one row)",
      arrange: async f => {
        const cleanup = await arrange(replay)(f);
        try {
          const first = await ask(f, "/api/cash-drawer", { ...body(replay, "tips"), ref: replay.ref, shiftId: replay.shift });
          replay.id = first.id;
          replay.countBefore = await count(f, replay);
          if (replay.countBefore !== 1) throw new Error(`first withdrawal left ${replay.countBefore} rows`);
          return cleanup;
        } catch (error) { await cleanup(); throw error; }
      },
      body: () => ({ ...body(replay, "other"), ref: replay.ref, shiftId: replay.shift }), expect: [409],
      expectError: /already sent before with different details|ya se había enviado antes con otros datos/i,
      effect: async f => {
        const after = await count(f, replay), stored = await rows(f, replay);
        return after === replay.countBefore && after === 1 && stored.length === 1 && stored[0].id === replay.id
          && stored[0].request_ref === replay.ref && stored[0].purpose === "tips" && Number(stored[0].amount) === 8.5
          || `withdrawals ${replay.countBefore} -> ${after}, stored ${JSON.stringify(stored)}`;
      } },
    { ...base(expected), name: "POST /api/cash-drawer (tips and other reduce expected cash equally)",
      body: () => body(expected, "tips"), expect: [200],
      check: async (d, f) => {
        const tipsTotals = await totals(f, expected);
        const removed = await checked(f.admin.from("cash_movements").delete().eq("restaurant_id", r)
          .eq("shift_id", expected.shift).eq("id", d.id).select("id").single());
        if (removed.id !== d.id) return "the tips withdrawal was not removed";
        const other = await ask(f, "/api/cash-drawer", body(expected, "other"));
        const otherTotals = await totals(f, expected), stored = await rows(f, expected);
        return stored.length === 1 && stored[0].id === other.id && stored[0].purpose === "other"
          && Number(tipsTotals.tips_out) === 8.5 && Number(otherTotals.tips_out) === 0
          && Number(tipsTotals.expected) === Number(expected.before.expected) - 8.5
          && Number(otherTotals.expected) === Number(tipsTotals.expected)
          && Number(tipsTotals.withdrawn) === 8.5 && Number(otherTotals.withdrawn) === 8.5
          || `tips ${JSON.stringify(tipsTotals)}, other ${JSON.stringify(otherTotals)}, stored ${JSON.stringify(stored)}`;
      } },
  ];
}
