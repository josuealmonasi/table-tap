import assert from "node:assert/strict";
import { splitSlotFixture } from "./split-slots-fixture.mjs";

/** Judge receipts and owners, not just HTTP refusals: money must move exactly once. */
export async function attackSplitSlots({ admin, post, who, home, neighbour, ok, bad }) {
  async function run(label, operation, options) {
    let fixture;
    try {
      fixture = await splitSlotFixture(admin, home.id, options);
      await operation(fixture);
      ok(`split slots: ${label}`);
    } catch (error) { bad(`split slots: ${label}: ${error.message}`); }
    finally { if (fixture) await fixture.cleanup(); }
  }
  await run("overlapping groups reserve all their parts or none", async f => {
    const [a, b] = await Promise.all([f.hold([0, 1]), f.hold([1, 2])]);
    assert.deepEqual([a.result.outcome, b.result.outcome].sort(), ["reserved", "taken"]);
    const winner = a.result.outcome === "reserved" ? a : b;
    const rows = await f.slots();
    assert.equal(rows.filter(s => s.reserved_checkout_id === winner.id).length, 2);
    assert.equal(rows.filter(s => s.reserved_checkout_id && s.reserved_checkout_id !== winner.id).length, 0);
    assert.equal((await f.receipts()).length, 0);
    const retry = await f.rpc("reserve_split_slots_v1", winner.args);
    assert.equal(retry.outcome, "repeat");
    assert.deepEqual(await f.slots(), rows);
  }, { shares: 3, totalCents: 9000 });
  await run("cash cannot collect a card-held part; cancel remains frozen", async f => {
    assert.equal((await f.hold()).result.outcome, "reserved");
    const before = await f.slots();
    const cash = await post("/api/split/collect", f.body(), who.waiter);
    assert.equal(cash.status, 409); assert.equal(cash.body.code, "reserved");
    const cancel = await post("/api/split/cancel", f.body(), who.waiter);
    assert.equal(cancel.status, 409); assert.equal(cancel.body.code, "frozen");
    assert.equal((await f.receipts()).length, 0);
    assert.deepEqual(await f.slots(), before);
    // Both whole-table entry points must tell staff to collect parts instead.
    for (const path of ["/api/table-payment", "/api/table-payment/part"]) {
      const result = await post(path, { tableId: f.scope.tableId, settlement: "cash", method: "cash",
        expected: 110, amount: 55, tip: 0, currency: "MXN", ref: crypto.randomUUID() }, who.waiter);
      assert.equal(result.status, 409); assert.equal(result.body.code, "split");
      assert.equal((await f.receipts()).length, 0);
    }
  });
  await run("a stale revision and another restaurant cannot collect or change parts", async f => {
    const before = await f.slots();
    const stale = await post("/api/split/collect", { ...f.body(), revision: 2 }, who.waiter);
    assert.equal(stale.status, 409); assert.equal(stale.body.code, "stale");
    for (const path of ["/api/split/collect", "/api/split/resize", "/api/split/cancel"]) {
      const foreign = await post(path, { ...f.body(), restaurantId: neighbour.id, shares: 3 }, who.waiter);
      assert.equal(foreign.status, 403);
    }
    assert.deepEqual(await f.slots(), before); assert.equal((await f.receipts()).length, 0);
  });
  await run("the kitchen cannot start, change, cancel or collect the split", async f => {
    const before = await f.slots();
    for (const path of ["/api/split/start", "/api/split/resize", "/api/split/cancel", "/api/split/collect"]) {
      const result = await post(path, { ...f.startBody, ...f.body(), shares: 3 }, who.kitchen);
      assert.equal(result.status, 403);
    }
    assert.deepEqual(await f.slots(), before); assert.equal((await f.receipts()).length, 0);
  });
  for (const currency of ["MXN", "USD"]) await run(`${currency} mixed cash and own-terminal receipts survive retries`, async f => {
    const first = { ...f.body([0]), tipCents: 500 };
    const a = await post("/api/split/collect", first, who.waiter);
    assert.equal(a.status, 200); assert.equal(a.body.outcome, "collected");
    const retry = await post("/api/split/collect", first, who.waiter);
    assert.equal(retry.status, 200); assert.equal(retry.body.outcome, "duplicate");
    const b = await post("/api/split/collect", { ...f.body([1]), method: "card" }, who.waiter);
    assert.equal(b.status, 200);
    const receipts = await f.receipts();
    assert.equal(receipts.length, 2);
    assert.equal(receipts.reduce((sum, p) => sum + Math.round(Number(p.amount) * 100), 0), 11500);
    assert.deepEqual(receipts.map(p => p.method).sort(), ["card", "cash"]);
    assert.ok(receipts.every(p => p.currency === currency && p.actor_email));
    assert.ok((await f.slots()).every(s => s.payment_id && !s.reserved_checkout_id));
    const { data: order, error } = await admin.from("orders").select("paid, pay_method").eq("id", f.orderId).single();
    if (error) throw new Error(error.message);
    assert.equal(order.paid, true); assert.equal(order.pay_method, null);
  }, { currency });
}
