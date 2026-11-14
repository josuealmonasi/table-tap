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
it("review cases and their money stay out of the tenant's books and pending note", async () => {
  const f = fixture();
  f.tables.stripe_disputes = [{ ...dispute, restaurant_id: "original", reconciliation_state: "reconciled", status: "lost" },
    { ...dispute, id: "review", stripe_dispute_id: "dp_review", restaurant_id: "original", reconciliation_state: "review", status: "needs_response" }];
  f.tables.stripe_dispute_movements = [{ ...movement, restaurant_id: "original" },
    { ...movement, restaurant_id: "original", dispute_id: "review", stripe_balance_transaction_id: "txn_review" }];
  // A later notification on the review case failed: platform work, not a tenant note.
  f.tables.stripe_dispute_events = [{ ...dispute, stripe_dispute_id: "dp_review", restaurant_id: "original", state: "error" }];
  const read = await readDisputes(f.db, "original");
  expect(read).toMatchObject({ cases: [{ id: "case" }], movements: [movement], pending: 0 });
  expect(read.cases).toHaveLength(1);
});
it("an event set aside for review counts as needs-review, not pending, and marks its case", async () => {
  const f = fixture();
  f.tables.stripe_disputes = [{ ...dispute, restaurant_id: "original", reconciliation_state: "reconciled" },
    { ...dispute, id: "other", stripe_dispute_id: "dp_other", restaurant_id: "original", reconciliation_state: "reconciled" }];
  f.tables.stripe_dispute_events = [{ ...dispute, restaurant_id: "original", state: "review" },
    { ...dispute, stripe_dispute_id: "dp_other", restaurant_id: "original", state: "error" }];
  const read = await readDisputes(f.db, "original");
  expect(read).toMatchObject({ pending: 1, review: 1 });
  expect(read.cases.find(d => d.id === "case")?.reconciliation_state).toBe("needs_review");
  expect(read.cases.find(d => d.id === "other")?.reconciliation_state).toBe("pending");
});
