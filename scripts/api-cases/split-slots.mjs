import { splitSlotFixture } from "../split-slots-fixture.mjs";

export function splitSlotCases(fx) {
  const r = fx.restaurant.id;
  const arrange = options => async f => { f.slotCase = await splitSlotFixture(f.admin, r, options); return f.slotCase.cleanup; };
  const controlBody = f => ({ ...f.slotCase.scope, splitId: f.slotCase.splitId, revision: 1, shares: 3 });
  const error = {
    stale: /cuenta cambió|bill changed/i, frozen: /empezó a pagar|started paying/i,
    gone: /ya no está disponible|no longer available/i, taken: /ya está pagando|already paying/i,
    reserved: /ya está pagando|already paying/i, paid: /ya está pagada|already paid/i,
    below_minimum: /más partes|more parts/i, currency: /monedas|currenc/i,
    busy: /ya.*divid|already.*split/i, conflict: /otras partes|different parts/i,
  };
  return [
    { name: "POST /api/split/start (four parts with one phone on a staff-opened table)", as: "diner", method: "POST", path: "/api/split/start",
      arrange: arrange({ start: false, shares: 4 }), body: f => f.slotCase.startBody, expect: [200],
      check: async (d, f) => {
        const { data, error: readError } = await f.admin.from("bill_split_slots").select("amount_cents").eq("split_id", d.split);
        if (readError) return readError.message;
        return data.length === 4 && data.reduce((sum, row) => sum + row.amount_cents, 0) === 11000 || "slots did not freeze the full reviewed debt";
      } },
    ...["stale", "busy", "currency", "nothing"].map(outcome => ({
      name: `POST /api/split/start (${outcome})`, as: "waiter", method: "POST", path: "/api/split/start",
      arrange: arrange({ start: outcome === "busy", totalCents: outcome === "nothing" ? 0 : 11000 }),
      body: f => ({ ...f.slotCase.startBody, ref: crypto.randomUUID(), ...(outcome === "stale" ? { expectedCents: 10000 } : {}),
        ...(outcome === "currency" ? { currency: "USD" } : {}) }), expect: [409],
      expectError: outcome === "nothing" ? /nada|nothing/i : error[outcome],
    })),
    { name: "POST /api/split/start (same request returns its split)", as: "waiter", method: "POST", path: "/api/split/start",
      arrange: arrange(), body: f => f.slotCase.startBody, expect: [200], check: (d, f) => d.outcome === "repeat" && d.split === f.slotCase.splitId || "start made a second split" },
    ...[["resize", "/api/split/resize"], ["cancel", "/api/split/cancel"]].flatMap(([action, path]) => [
      { name: `POST /api/split/${action} (current revision)`, as: "waiter", method: "POST", path,
        arrange: arrange(), body: controlBody, expect: [200], check: d => d.revision === 2 || "revision did not advance" },
      ...["stale", "frozen", "gone"].map(outcome => ({
        name: `POST /api/split/${action} (${outcome})`, as: "waiter", method: "POST", path,
        arrange: async f => {
          const cleanup = await arrange()(f);
          try {
            if (outcome === "frozen") { const hold = await f.slotCase.hold(); if (hold.result.outcome !== "reserved") throw new Error("fixture did not reserve"); }
            return cleanup;
          } catch (e) { await cleanup(); throw e; }
        },
        body: f => ({ ...controlBody(f), ...(outcome === "stale" ? { revision: 2 } : {}),
          ...(outcome === "gone" ? { splitId: crypto.randomUUID() } : {}) }), expect: [409], expectError: error[outcome],
      })),
    ]),
    ...["cash", "card", "duplicate", "reserved", "paid", "stale", "currency"].map(outcome => ({
      name: `POST /api/split/collect (${outcome})`, as: "waiter", method: "POST", path: "/api/split/collect",
      arrange: async f => {
        const cleanup = await arrange()(f);
        f.slotCollection = f.slotCase.body();
        try {
          if (outcome === "reserved") { const hold = await f.slotCase.hold(); if (hold.result.outcome !== "reserved") throw new Error("fixture did not reserve"); }
          if (["duplicate", "paid"].includes(outcome)) {
            const b = f.slotCollection;
            const result = await f.slotCase.rpc("collect_split_slots_v1", { p_restaurant: r, p_split: b.splitId, p_revision: 1, p_slots: b.slots,
              p_expected_cents: b.expectedCents, p_currency: b.currency, p_tip_cents: 0, p_method: "cash", p_actor: "split-fixture", p_ref: b.ref });
            if (result.outcome !== "collected") throw new Error(`fixture collection: ${result.outcome}`);
          }
          return cleanup;
        } catch (e) { await cleanup(); throw e; }
      },
      body: f => ({ ...f.slotCollection, ...(outcome === "card" ? { method: "card" } : {}),
        ...(outcome === "stale" ? { revision: 2 } : {}), ...(outcome === "currency" ? { currency: "USD" } : {}),
        ...(outcome === "paid" ? { ref: crypto.randomUUID() } : {}) }),
      expect: [(["cash", "card", "duplicate"].includes(outcome) ? 200 : 409)],
      ...(!["cash", "card", "duplicate"].includes(outcome) ? { expectError: error[outcome] } : {}),
      effect: async f => {
        const receipts = await f.slotCase.receipts();
        const expected = ["cash", "card", "duplicate", "paid"].includes(outcome) ? 1 : 0;
        return receipts.length === expected || `expected ${expected} receipts, found ${receipts.length}`;
      },
    })),
    ...["taken", "paid", "stale", "below_minimum"].map(outcome => ({
      name: `POST /api/split/pay (model 2 ${outcome})`, as: "diner", method: "POST", path: "/api/split/pay",
      arrange: async f => {
        const cleanup = await arrange({ totalCents: outcome === "below_minimum" ? 1000 : 11000 })(f);
        let reader;
        try {
          reader = await f.withCardReader();
          if (outcome === "taken") { const hold = await f.slotCase.hold(); if (hold.result.outcome !== "reserved") throw new Error("fixture did not reserve"); }
          if (outcome === "paid") {
            const b = f.slotCase.body();
            const result = await f.slotCase.rpc("collect_split_slots_v1", { p_restaurant: r, p_split: b.splitId, p_revision: 1,
              p_slots: [0], p_expected_cents: b.expectedCents, p_currency: "MXN", p_tip_cents: 0, p_method: "cash", p_actor: "split-fixture", p_ref: b.ref });
            if (result.outcome !== "collected") throw new Error(`fixture collection: ${result.outcome}`);
          }
          return async () => { try { await cleanup(); } finally { await reader(); } };
        } catch (e) { try { await cleanup(); } finally { if (reader) await reader(); } throw e; }
      },
      body: f => ({ ...f.slotCase.body(), ...(outcome === "stale" ? { revision: 2 } : {}) }), expect: [409], expectError: error[outcome],
    })),
  ];
}
