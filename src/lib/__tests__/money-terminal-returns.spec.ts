import { expect, it, vi } from "vitest";
import { checkDrawer } from "../../../scripts/money-drawer.mjs";
import { at, database, fixture, type Rows } from "./money-drawer-fixtures";

function withReturn(day: number, hour = 16): Rows {
  const rows: Rows = fixture();
  rows.refund_operations = [{ id: "refund", restaurant_id: "r", currency: "MXN", source: "terminal",
    status: "succeeded", amount: 40, completed_at: at(day, hour) }];
  rows.payment_allocations = [{ id: "allocation", restaurant_id: "r", payment_id: "card" }];
  rows.refund_allocations = [{ id: "return", restaurant_id: "r", operation_id: "refund", allocation_id: "allocation", amount: 40, tip: 0 }];
  rows.ledger.push({ id: "return:return", payment_id: "card", amount: 40, tip: 0,
    created_at: at(23), recorded_at: at(day, hour), returned_at: at(day, hour) });
  return rows;
}
it("reverses the fee on a same-day partial void before sign-off", async () => {
  const rows = withReturn(23);
  rows.terminal_deposits[0] = { ...rows.terminal_deposits[0], expected: 57.9, return_ids: ["return:return"] };
  const h = database(rows); await checkDrawer(h.db, h.all, h);
  expect(h.bad).not.toHaveBeenCalled();
});
it("names a refund omitted from a signed manifest", async () => {
  const h = database(withReturn(23)); await checkDrawer(h.db, h.all, h);
  expect(h.bad).toHaveBeenCalledWith(expect.stringMatching(/deposit.*missing return return:return/));
});
it.each([[23, 57.9], [24, 56.5]])("carries a return on day %s using the original fee only for same-day voids", async (day, expected) => {
  const rows = withReturn(day, 19);
  rows.payments.push({ ...rows.payments[1], id: "next-card", created_at: at(25), recorded_at: at(25) });
  rows.ledger.push({ ...rows.ledger[0], id: "next-card", payment_id: "next-card", created_at: at(25), recorded_at: at(25) });
  rows.terminal_deposits.push({ ...rows.terminal_deposits[0], id: "next", sales_day: "2026-10-25",
    created_at: at(25, 20), snapshot_at: at(25, 20), expected, payment_ids: ["next-card"], return_ids: ["return:return"] });
  const h = database(rows); await checkDrawer(h.db, h.all, h);
  expect(h.bad).not.toHaveBeenCalled();
  // Reversing a later refund's fee would flatter the next deposit by MX$1.40.
  rows.terminal_deposits[1] = { ...rows.terminal_deposits[1], expected: Number(expected) + 1.4 };
  const wrong = database(rows); await checkDrawer(wrong.db, wrong.all, wrong);
  expect(wrong.bad).toHaveBeenCalledWith(expect.stringMatching(/deposit next expected/));
});
it("names a return consumed by two deposits", async () => {
  const rows = withReturn(23);
  rows.terminal_deposits[0] = { ...rows.terminal_deposits[0], expected: 57.9, return_ids: ["return:return"] };
  rows.terminal_deposits.push({ ...rows.terminal_deposits[0], id: "duplicate" });
  const h = database(rows); await checkDrawer(h.db, h.all, h);
  expect(h.bad).toHaveBeenCalledWith(expect.stringMatching(/return return:return.*deposits.*duplicate/));
});
it("keeps an unconsumed same-day return visible after the last deposit with its original fee", async () => {
  const rows = withReturn(23, 19);
  rows.restaurants[0] = { ...rows.restaurants[0], terminal_fee_pct: 5 };
  const h = { ...database(rows), info: vi.fn() }; await checkDrawer(h.db, h.all, h);
  expect(h.bad).not.toHaveBeenCalled();
  expect(h.info).toHaveBeenCalledWith(expect.stringMatching(/return:return.*later deposit \(38.60 MXN\)/));
  expect(h.ok).toHaveBeenCalledWith(expect.stringMatching(/pending terminal returns.*1 checked/));
});
it("names a receipt included after its deposit cutoff", async () => {
  const rows = fixture(); rows.payments[1].recorded_at = at(24); rows.ledger[0].recorded_at = at(24);
  const h = database(rows); await checkDrawer(h.db, h.all, h);
  expect(h.bad).toHaveBeenCalledWith(expect.stringMatching(/deposit deposit receipt card.*cutoff/));
});
it("uses the restaurant day at the timezone boundary and the saved fee", async () => {
  const rows = fixture();
  rows.restaurants[0].timezone = "America/Mexico_City"; rows.restaurants[0].terminal_fee_pct = 5;
  rows.payments[1].created_at = "2026-10-24T01:00:00Z";
  rows.payments[1].recorded_at = "2026-10-24T01:00:00Z";
  rows.ledger[0].created_at = rows.payments[1].created_at; rows.ledger[0].recorded_at = rows.payments[1].recorded_at;
  rows.terminal_deposits[0].created_at = at(24, 10); rows.terminal_deposits[0].snapshot_at = at(24, 10);
  const h = database(rows); await checkDrawer(h.db, h.all, h);
  expect(h.bad).not.toHaveBeenCalled();
});
