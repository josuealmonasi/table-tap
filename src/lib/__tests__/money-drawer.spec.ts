import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { checkDrawer } from "../../../scripts/money-drawer.mjs";
import { at, database, fixture } from "./money-drawer-fixtures";

it("runs the drawer check from money:prod as well as money", () => {
  expect(readFileSync("scripts/money-check.mjs", "utf8")).toMatch(/await checkDrawer\(db, all, \{ ok, bad \}\)/);
});
it("reconciles a signed shift and terminal deposit and reports checked counts", async () => {
  const h = database(fixture());
  await checkDrawer(h.db, h.all, h);
  expect(h.bad).not.toHaveBeenCalled();
  expect(h.ok).toHaveBeenCalledWith(expect.stringMatching(/closed cash shifts.*\(1 checked\)/));
  expect(h.ok).toHaveBeenCalledWith(expect.stringMatching(/terminal deposits.*\(1 checked\)/));
  expect(h.reads).toContain("payments:2");
  expect(h.reads).toContain("ledger:1");
});
it("names a shift whose signed expected cash is MX$10 wrong", async () => {
  const rows = fixture(); rows.cash_shifts[0].expected_cash += 10;
  const h = database(rows); await checkDrawer(h.db, h.all, h);
  expect(h.bad).toHaveBeenCalledWith(expect.stringMatching(/shift.*expected/));
});
it("names a receipt included in two deposits", async () => {
  const rows = fixture(); rows.terminal_deposits.push({ ...rows.terminal_deposits[0], id: "duplicate" });
  const h = database(rows); await checkDrawer(h.db, h.all, h);
  expect(h.bad).toHaveBeenCalledWith(expect.stringMatching(/card.*deposit.*duplicate/));
});
it("names a late receipt that vanished from the terminal adjustment ledger", async () => {
  const rows = fixture();
  rows.payments.push({ ...rows.payments[1], id: "late", recorded_at: at(24) });
  const h = database(rows); await checkDrawer(h.db, h.all, h);
  expect(h.bad).toHaveBeenCalledWith(expect.stringMatching(/late.*terminal ledger/));
});
it.each(["cash_shifts", "cash_movements", "terminal_deposits", "payments", "refund_operations", "user_logs",
  "orders", "restaurants", "payment_allocations", "refund_allocations", "order_adjustments", "ledger"])("fails closed on a %s read error", async table => {
  const h = database(fixture(), table); await checkDrawer(h.db, h.all, h);
  expect(h.bad).toHaveBeenCalledWith(expect.stringContaining("read refused"));
  expect(h.ok).not.toHaveBeenCalled();
});
it("fails on an error after a successful page instead of auditing a partial ledger", async () => {
  const h = database(fixture(), "payments", 1); await checkDrawer(h.db, h.all, h);
  expect(h.bad).toHaveBeenCalledWith(expect.stringContaining("payments"));
  expect(h.ok).not.toHaveBeenCalled();
});
