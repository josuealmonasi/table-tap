import { expect, it } from "vitest";
import { checkDrawer } from "../../../scripts/money-drawer.mjs";
import { at, database, fixture, type Rows } from "./money-drawer-fixtures";

function returned(): Rows {
  const rows: Rows = fixture();
  rows.refund_operations.push({ id: "refund", restaurant_id: "r", currency: "MXN", source: "terminal",
    status: "succeeded", amount: 40, completed_at: at(24, 16) });
  rows.payment_allocations.push({ id: "allocation", restaurant_id: "r", payment_id: "card" });
  rows.refund_allocations.push({ id: "return", restaurant_id: "r", operation_id: "refund", allocation_id: "allocation", amount: 40, tip: 0 });
  rows.ledger.push({ id: "return:return", payment_id: "card", amount: 40, tip: 0,
    created_at: at(23), recorded_at: at(24, 16), returned_at: at(24, 16) });
  return rows;
}
function signed(rows: Rows, day = 24, expected = -40, payments: string[] = [], returns = ["return:return"]) {
  rows.terminal_deposits.push({ ...rows.terminal_deposits[0], id: `deposit-${day}`, sales_day: `2026-10-${day}`,
    created_at: at(day, 20), snapshot_at: at(day, 20), expected, received: expected, payment_ids: payments, return_ids: returns });
}
function sale(rows: Rows) {
  rows.payments.push({ ...rows.payments[1], id: "next", created_at: at(25), recorded_at: at(25) });
  rows.ledger.push({ ...rows.ledger[0], id: "next", payment_id: "next", created_at: at(25), recorded_at: at(25) });
}
async function check(rows: Rows) {
  const h = database(rows); await checkDrawer(h.db, h.all, h); return h;
}

it("F6 reconciles the own-day MX$40 bank debit with no new sales, even after a currency switch", async () => {
  const rows = returned(); rows.restaurants[0] = { ...rows.restaurants[0], currency: "USD" };
  signed(rows);
  const h = await check(rows);
  expect(h.bad).not.toHaveBeenCalled();
  expect(h.ok).toHaveBeenCalledWith("terminal deposits reconcile (2 checked)");
  expect(h.ok).toHaveBeenCalledWith("pending terminal returns remain visible (0 checked)");
});

it("F6 rejects a return-only manifest omitting its MX$40 return even if expected is forged to zero", async () => {
  const rows = returned(); signed(rows, 24, 0, [], []);
  expect((await check(rows)).bad).toHaveBeenCalledWith("deposit deposit-24 is missing return return:return");
});

it("F6 rejects the wrong expected amount on a return-only bank debit", async () => {
  const rows = returned(); signed(rows, 24, -38.6);
  expect((await check(rows)).bad).toHaveBeenCalledWith(expect.stringMatching(/deposit deposit-24 expected -38.6.*-40.00 MXN/));
});

it("F6 a sale tomorrow before marking carries the return there, not to its own day", async () => {
  const rows = returned(); sale(rows); signed(rows, 25, 56.5, ["next"]);
  expect((await check(rows)).bad).not.toHaveBeenCalled();
  const wrong = returned(); sale(wrong); signed(wrong, 24);
  // Backdated sales_day, but signed after tomorrow's receipt was available.
  wrong.terminal_deposits[1] = { ...wrong.terminal_deposits[1], created_at: at(25, 20), snapshot_at: at(25, 20) };
  expect((await check(wrong)).bad).toHaveBeenCalledWith("deposit deposit-24 return return:return belongs to 2026-10-25");
});

it("F6 marked return-only day never carries again, even after a new MXN sale", async () => {
  const rows = returned(); signed(rows); sale(rows); signed(rows, 25, 96.5, ["next"], []);
  const h = await check(rows);
  expect(h.bad).not.toHaveBeenCalled();
  expect(h.ok).toHaveBeenCalledWith("pending terminal returns remain visible (0 checked)");
  // A later mark trying to consume it twice is detected by effect.
  rows.terminal_deposits[2] = { ...rows.terminal_deposits[2], expected: 56.5, return_ids: ["return:return"] };
  expect((await check(rows)).bad).toHaveBeenCalledWith(expect.stringMatching(/return return:return appears in deposits deposit-24 and deposit-25/));
});

it("F6 a day owning neither net sales nor returns cannot have a signed manifest", async () => {
  const rows: Rows = fixture(); signed(rows, 24, 0, [], []);
  expect((await check(rows)).bad).toHaveBeenCalledWith("deposit deposit-24 has no net sales or owned returns");
});
