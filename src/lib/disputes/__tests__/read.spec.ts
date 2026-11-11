import { expect, it } from "vitest";
import { fixture } from "./fixtures";
import { readDisputes, readDisputeHistory } from "../read";
import { dispute, movement } from "./report-fixtures";

it("private reads scope every row by tenant and configured Stripe mode", async () => {
  const f = fixture();
  f.tables.stripe_disputes = [{ ...dispute, restaurant_id: "original" }, { ...dispute, id: "foreign", restaurant_id: "other" }, { ...dispute, id: "live", restaurant_id: "original", livemode: true }];
  f.tables.stripe_dispute_movements = [{ ...movement, restaurant_id: "original" }, { ...movement, restaurant_id: "other" }];
  f.tables.stripe_dispute_events = [{ ...dispute, restaurant_id: "original", state: "error" }];
  expect(await readDisputes(f.db, "original")).toMatchObject({ cases: [{ id: "case" }], movements: [movement], pending: 1 });
});
it("a shared-charge history is visible on each covered order without a foreign link", async () => {
  const f = fixture(); f.tables.diner_checkouts[0].order_ids = ["order1", "order2"];
  f.tables.stripe_disputes = [{ ...dispute, restaurant_id: "original", stripe_account_id: "acct_old", order_id: null, reconciliation_state: "reconciled" }];
  f.tables.stripe_dispute_movements = [{ ...movement, restaurant_id: "original" }];
  const history = await readDisputeHistory(f.db, "original", ["order1", "order2", "foreign"]);
  expect(history.order1[0]).toMatchObject({ shared: true, movements: [movement] });
  expect(history.order2).toEqual(history.order1);
  expect(history.foreign).toEqual([]);
});
it("a failed private read throws rather than inventing an empty report", async () => {
  const f = fixture(); f.from.mockImplementation(() => { throw new Error("database offline"); });
  await expect(readDisputes(f.db, "original")).rejects.toThrow("offline");
});
it("review cases never claim an order link", async () => {
  const f = fixture(); f.tables.stripe_disputes = [{ ...dispute, restaurant_id: "original", reconciliation_state: "review" }];
  expect(await readDisputeHistory(f.db, "original", ["order1"])).toEqual({ order1: [] });
});
it("an error on a later notification makes an older verified history visibly pending", async () => {
  const f = fixture(); f.tables.stripe_disputes = [{ ...dispute, restaurant_id: "original", stripe_account_id: "acct_old", reconciliation_state: "reconciled" }];
  f.tables.stripe_dispute_events = [{ ...dispute, restaurant_id: "original", stripe_account_id: "acct_old", state: "error" }];
  expect((await readDisputes(f.db, "original")).cases[0].reconciliation_state).toBe("pending");
});
