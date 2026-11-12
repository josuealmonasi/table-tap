import { randomUUID } from "node:crypto";
import { loyaltyAttachmentFixture } from "../api-loyalty-attachment-fixture.mjs";

export function loyaltyAttachCases() {
  const arrange = async f => {
    f.attachCase = await loyaltyAttachmentFixture(f);
    return f.attachCase.cleanup;
  };
  const base = { method: "POST", path: "/api/loyalty/attach", arrange,
    headers: f => ({ "x-forwarded-for": f.attachCase.address }) };
  const body = f => ({ orderId: f.attachCase.ids[0], code: f.attachCase.code });
  return [
    ...["owner", "manager", "cashier", "waiter"].map(as => ({ ...base, as, body,
      name: `POST /api/loyalty/attach (${as}, unpaid counter order)`, expect: [200],
      check: async (d, f) => {
        const { data, error } = await f.admin.from("orders").select("loyalty_card_id").eq("id", f.attachCase.ids[0]).single();
        if (error || data?.loyalty_card_id !== f.attachCase.cardId) return "the card was not attached to the order";
        return d.card?.suffix === f.attachCase.code.slice(-4) && (await f.attachCase.visits()).length === 0
          || "attachment exposed the code or stamped before payment";
      } })),
    { ...base, name: "POST /api/loyalty/attach (kitchen refused)", as: "kitchen", body, expect: [403] },
    { ...base, name: "POST /api/loyalty/attach (unknown card)", as: "waiter",
      body: f => ({ ...body(f), code: "000000000000" }), expect: [404] },
    { ...base, name: "POST /api/loyalty/attach (gone order)", as: "waiter",
      body: f => ({ ...body(f), orderId: randomUUID() }), expect: [404] },
    { ...base, name: "POST /api/loyalty/attach (program off)", as: "waiter", body, expect: [409],
      arrange: async f => {
        const cleanup = await arrange(f);
        try { const restore = await f.withLoyaltyOff(); return async () => { await restore(); await cleanup(); }; }
        catch (error) { await cleanup(); throw error; }
      } },
    { ...base, name: "POST /api/loyalty/attach (already paid)", as: "waiter", body, expect: [409],
      arrange: async f => {
        const cleanup = await arrange(f);
        try { const res = await f.attachCase.pay(f.attachCase.ids[0]); if (res.status !== 200) throw new Error(JSON.stringify(res)); return cleanup; }
        catch (error) { await cleanup(); throw error; }
      } },
    { ...base, name: "POST /api/loyalty/attach (diner's own sitting)", as: "diner", expect: [200],
      headers: f => ({ cookie: f.attachCase.cookie, "x-forwarded-for": f.attachCase.address }), body: f => f.attachCase.body,
      check: async (_d, f) => {
        const { data, error } = await f.admin.from("table_sessions").select("loyalty_card_id").eq("id", f.attachCase.sessionId).single();
        return !error && data?.loyalty_card_id === f.attachCase.cardId || "the diner's sitting has no card";
      } },
    { ...base, name: "POST /api/loyalty/attach (diner cannot name another sitting)", as: "diner", expect: [403],
      headers: f => ({ cookie: f.attachCase.cookie, "x-forwarded-for": f.attachCase.address }), body: f => ({ ...f.attachCase.body, sessionId: randomUUID() }) },
    { ...base, name: "POST /api/loyalty/attach (paying stamps once a day)", as: "cashier", body, expect: [200],
      check: async (_d, f) => {
        const fixture = f.attachCase;
        if ((await fixture.attach(fixture.ids[1])).status !== 200) return "second order could not attach";
        for (const id of fixture.ids) {
          const res = await fixture.pay(id);
          if (res.status !== 200) return `payment failed: ${JSON.stringify(res)}`;
        }
        const visits = await fixture.visits();
        return visits.length === 1 && visits[0].actor_email === "payment" || `two paid orders recorded ${visits.length} visits`;
      } },
    { ...base, name: "POST /api/loyalty/attach (paying inherits the sitting card)", as: "waiter", expect: [200],
      body: f => ({ sessionId: f.attachCase.sessionId, code: f.attachCase.code }),
      check: async (_d, f) => {
        const fixture = f.attachCase;
        const { error } = await f.admin.from("orders").update({ table_id: fixture.tableId, session_id: fixture.sessionId })
          .eq("restaurant_id", f.restaurant.id).in("id", fixture.ids);
        if (error) return error.message;
        const paid = await fixture.send("/api/table-payment", { tableId: fixture.tableId, settlement: "cash", expected: 20, currency: "MXN", ref: randomUUID() });
        if (paid.status !== 200) return `table payment failed: ${JSON.stringify(paid)}`;
        const visits = await fixture.visits();
        return visits.length === 1 && visits[0].actor_email === "payment" || "the sitting's card did not receive exactly one visit";
      } },
    { ...base, name: "POST /api/loyalty/attach (remove before paying)", as: "cashier", expect: [200],
      body: f => ({ orderId: f.attachCase.ids[0], remove: true }),
      arrange: async f => {
        const cleanup = await arrange(f);
        try { if ((await f.attachCase.attach(f.attachCase.ids[0])).status !== 200) throw new Error("Could not attach fixture"); return cleanup; }
        catch (error) { await cleanup(); throw error; }
      },
      check: async (_d, f) => {
        const { data, error } = await f.admin.from("orders").select("loyalty_card_id").eq("id", f.attachCase.ids[0]).single();
        return !error && data?.loyalty_card_id === null || "card not removed";
      } },
  ];
}
