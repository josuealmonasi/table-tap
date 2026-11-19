import { describe, expect, it } from "vitest";
import { inactiveOrderCases } from "../../../scripts/api-inactive-orders.mjs";
import { frozenOfferCases } from "../../../scripts/api-frozen-offers.mjs";

function fixture() {
  const writes: { table: string; op: string }[] = [];
  const admin = { from: (table: string) => {
    let op = "select";
    const query = {
      select: () => query, eq: () => query,
      insert: () => { op = "insert"; writes.push({ table, op }); return query; },
      update: () => { op = "update"; writes.push({ table, op }); return query; },
      delete: () => { op = "delete"; writes.push({ table, op }); return query; },
      single: async () => ({ data: { id: `${table}-${writes.length}`, kitchen_ticket_id: "ticket", plan_status: "active" }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return query;
  } };
  return { admin, restaurant: { id: "home" }, dish: { id: "dish" }, writes,
    readOnlyFixtures: undefined as undefined | { cleanup: () => Promise<void> } };
}

describe("unchanged API fixtures", () => {
  it("shares one inactive order across both methods and both roles", async () => {
    const f = fixture();
    for (const test of inactiveOrderCases()) await (await test.arrange(f))();
    expect(f.writes.filter(w => w.table === "orders" && w.op === "insert")).toHaveLength(1);
    expect(f.writes.filter(w => w.op === "delete")).toHaveLength(0);
    await f.readOnlyFixtures!.cleanup();
    expect(f.writes.filter(w => w.table === "orders" && w.op === "delete")).toHaveLength(1);
  });
  it.each(["coupons", "promotions"])("shares the active %s only for refused writes", async table => {
    const f = fixture();
    const cases = frozenOfferCases().filter(c => c.path === `/api/${table}`);
    const restoreEdit = await cases[1].arrange(f);
    await restoreEdit();
    const restoreDelete = await cases[3].arrange(f);
    expect(f.writes.filter(w => w.table === table && w.op === "insert")).toHaveLength(1);
    expect(f.writes.filter(w => w.op === "delete")).toHaveLength(0);
    await restoreDelete();
    expect(f.writes.filter(w => w.table === table && w.op === "delete")).toHaveLength(1);
    await (await cases[0].arrange(f))();
    expect(f.writes.filter(w => w.table === table && w.op === "insert")).toHaveLength(2);
    expect(f.writes.filter(w => w.table === table && w.op === "delete")).toHaveLength(2);
    await f.readOnlyFixtures!.cleanup();
    expect(f.writes.filter(w => w.table === table && w.op === "delete")).toHaveLength(2);
  });
  it("removes every frozen offer before later cases can sell a discounted dish", async () => {
    const f = fixture();
    for (const test of frozenOfferCases()) await (await test.arrange(f))();
    for (const table of ["promotions", "coupons"]) {
      expect(f.writes.filter(w => w.table === table && w.op === "insert")).toHaveLength(3);
      expect(f.writes.filter(w => w.table === table && w.op === "delete")).toHaveLength(3);
    }
    const removed = f.writes.length;
    await f.readOnlyFixtures!.cleanup();
    expect(f.writes).toHaveLength(removed);
  });
});
