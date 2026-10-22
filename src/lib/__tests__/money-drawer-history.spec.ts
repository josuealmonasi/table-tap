import { expect, it, vi } from "vitest";
import { checkDrawer } from "../../../scripts/money-drawer.mjs";
import { at, database, fixture, type Rows } from "./money-drawer-fixtures";

it("leaves the original close intact after a late receipt, later refund and later withdrawal", async () => {
  const rows: Rows = fixture();
  rows.payments.push({ ...rows.payments[0], id: "late-cash", recorded_at: at(24) });
  rows.cash_movements.push({ ...rows.cash_movements[0], id: "later-withdrawal", created_at: at(24) });
  rows.refund_operations.push({ id: "later-refund", restaurant_id: "r", currency: "MXN", source: "cash",
    status: "succeeded", payout_actor: "cashier", amount: 100, completed_at: at(24) });
  const h = database(rows); await checkDrawer(h.db, h.all, h);
  expect(h.bad).not.toHaveBeenCalled();
  expect(h.ok).toHaveBeenCalledWith(expect.stringMatching(/closed cash shifts.*1 checked/));
});
it("subtracts completed cash returns once, including legacy logs with an order currency fallback", async () => {
  const rows: Rows = fixture();
  rows.refund_operations.push({ id: "refund", restaurant_id: "r", currency: "MXN", source: "cash",
    status: "succeeded", payout_actor: "cashier", amount: 15, completed_at: at(23, 14), historical_log_id: "imported" });
  rows.orders.push({ id: "abcd1234-full-id", restaurant_id: "r", currency: "MXN" });
  rows.user_logs.push(...["imported", "older"].map(id => ({ id, restaurant_id: "r", action: "refunded",
    created_at: at(23, 14), detail: `amount=15 method=cash collector=cashier order=abcd1234` })));
  rows.cash_shifts[0] = { ...rows.cash_shifts[0], expected_cash: 250, difference: 20 };
  const h = database(rows); await checkDrawer(h.db, h.all, h);
  expect(h.bad).not.toHaveBeenCalled();
});
it("prints an adjustment for every unnamed late receipt, even when its timestamp precedes the lock cutoff", async () => {
  const rows = fixture();
  for (const id of ["late", "waited-for-lock"]) {
    const p = { ...rows.payments[1], id, recorded_at: id === "late" ? at(24) : at(23) };
    rows.payments.push(p); rows.ledger.push({ ...p, stripe_payment_intent: null, payment_id: id, returned_at: null, voided_at: null });
  }
  const h = { ...database(rows), info: vi.fn() }; await checkDrawer(h.db, h.all, h);
  expect(h.bad).not.toHaveBeenCalled();
  for (const id of ["late", "waited-for-lock"]) expect(h.info).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`${id}.*adjustment 96.50 MXN`)));
  expect(h.ok).toHaveBeenCalledWith(expect.stringMatching(/adjustments \(2 checked\)/));
});
it("names a deposit whose expected amount is wrong", async () => {
  const rows = fixture(); rows.terminal_deposits[0].expected += 10;
  const h = database(rows); await checkDrawer(h.db, h.all, h);
  expect(h.bad).toHaveBeenCalledWith(expect.stringMatching(/deposit deposit expected/));
});
it("prints legacy skip counts, but fails a modern mark with no manifest", async () => {
  const rows: Rows = fixture();
  rows.cash_shifts.push({ id: "old-shift", closed_at: "2026-10-01T12:00:00Z" });
  rows.terminal_deposits.push({ id: "old-deposit", created_at: "2026-10-01T12:00:00Z" });
  const h = { ...database(rows), info: vi.fn() }; await checkDrawer(h.db, h.all, h);
  expect(h.bad).not.toHaveBeenCalled();
  expect(h.info).toHaveBeenCalledWith(expect.stringMatching(/closed cash shifts: 1 skipped/));
  expect(h.info).toHaveBeenCalledWith(expect.stringMatching(/terminal deposits: 1 skipped/));
  rows.terminal_deposits[0] = { ...rows.terminal_deposits[0], payment_ids: null };
  const invalid = database(rows); await checkDrawer(invalid.db, invalid.all, invalid);
  expect(invalid.bad).toHaveBeenCalledWith(expect.stringMatching(/deposit deposit lacks.*snapshot/));
});
it("checks empty tables explicitly", async () => {
  const h = database({}); await checkDrawer(h.db, h.all, h);
  expect(h.bad).not.toHaveBeenCalled();
  expect(h.ok).toHaveBeenCalledWith(expect.stringMatching(/closed cash shifts.*0 checked/));
  expect(h.ok).toHaveBeenCalledWith(expect.stringMatching(/terminal deposits.*0 checked/));
});
