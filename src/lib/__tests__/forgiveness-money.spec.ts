import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkAllocations } from "../../../scripts/money-allocations.mjs";

let tables: Record<string, Record<string, unknown>[]>;
let orders: Record<string, unknown>[];
let payments: Record<string, unknown>[];
const bad = vi.fn();
async function check() {
  const db = { from: (table: string) => {
    const q = { select: () => q, eq: () => q, then: (resolve: (rows: unknown) => unknown) => Promise.resolve(tables[table] ?? []).then(resolve) };
    return q;
  } };
  return checkAllocations(db, async (build: () => unknown) => ({ data: await build(), error: null }), orders, payments, { ok: vi.fn(), bad });
}
beforeEach(() => {
  bad.mockClear();
  orders = [{ id: "o", restaurant_id: "r", paid: true, written_off: false, status: "completed", total: 80, tip: 0 }];
  payments = [{ id: "p", restaurant_id: "r", amount: 80, tip: 0, allocation_version: 1, unallocated_amount: 0, unallocated_tip: 0 }];
  tables = {
    payment_allocations: [{ id: "a", restaurant_id: "r", order_id: "o", payment_id: "p", amount: 80, tip: 0 }],
    order_adjustments: [{ id: "adjustment", restaurant_id: "r", order_id: "o", kind: "forgive", previous_total: 100,
      resulting_total: 80, previous_tip: 0, resulting_tip: 0, forgiven: 20, currency: "MXN", operation_ref: "operation" }],
    user_logs: [{ id: "operation", restaurant_id: "r", actor_email: "owner", created_at: "2026-10-28T12:00:00.123456Z",
      entity: "bill", action: "written_off", detail: "kind=rest amount=70.00 currency=MXN" }],
    orders: [{ id: "whole", restaurant_id: "r", currency: "MXN", total: 50, written_off: true, written_off_by: "owner",
      written_off_at: "2026-10-28T12:00:00.123456Z" }],
  };
});
describe("reconciling the rest of a part-paid bill", () => {
  it("accepts one operation with MX$20 forgiven and an MX$50 wholly unpaid order, without calling it cancellation", async () => {
    const result = await check(); expect(bad).not.toHaveBeenCalled(); expect(result.cancelled.has("o")).toBe(false);
  });
  it.each(["forgiven", "resulting_total"])("rejects a wrong adjustment %s even when today's paid flag and coverage agree", async field => {
    tables.order_adjustments[0][field] = 79; await check(); expect(bad).toHaveBeenCalled();
  });
  it("requires the adjusted order to be paid", async () => { orders[0].paid = false; await check(); expect(bad).toHaveBeenCalled(); });
  it("checks coverage for a forgiven order even when no modern payment put it in the usual coverage loop", async () => {
    tables.payment_allocations = []; payments = []; await check(); expect(bad).toHaveBeenCalled();
  });
  it.each(["missing", "duplicate", "wrong amount", "foreign", "wrong kind"])("rejects a %s operation loss event", async fault => {
    const log = tables.user_logs[0];
    if (fault === "missing") tables.user_logs = [];
    if (fault === "duplicate") tables.user_logs.push({ ...log });
    if (fault === "wrong amount") log.detail = "kind=rest amount=20 currency=MXN";
    if (fault === "foreign") log.restaurant_id = "other";
    if (fault === "wrong kind") log.detail = "kind=whole amount=70 currency=MXN";
    await check(); expect(bad).toHaveBeenCalled();
  });
  it("checks rest operations made entirely of wholly written-off orders", async () => {
    tables.order_adjustments = []; tables.user_logs[0].detail = "kind=rest amount=20 currency=MXN";
    await check(); expect(bad).toHaveBeenCalled();
  });
  it("rounds original and resulting values to cents before comparing the loss, including unscaled legacy totals", async () => {
    Object.assign(tables.order_adjustments[0], { previous_total: "2.675", resulting_total: 2, forgiven: 0.68 });
    orders[0].total = 2; payments[0].amount = 2; tables.payment_allocations[0].amount = 2;
    tables.orders = []; tables.user_logs[0].detail = "kind=rest amount=0.68 currency=MXN";
    await check(); expect(bad).not.toHaveBeenCalled();
  });
});

it("does not match a whole loss to another tenant, actor, currency, or sub-millisecond timestamp", async () => {
  tables.orders.push(...[
    { restaurant_id: "other" }, { written_off_by: "other" }, { currency: "USD" }, { written_off_at: "2026-10-28T12:00:00.123457Z" },
  ].map((extra, i) => ({ ...tables.orders[0], id: `other-${i}`, ...extra })));
  await check(); expect(bad).not.toHaveBeenCalled();
});
it("refuses ambiguous whole-order membership rather than assigning one loss to two operations", async () => {
  tables.user_logs.push({ ...tables.user_logs[0], id: "another-operation", detail: "kind=rest amount=50 currency=MXN" });
  await check(); expect(bad).toHaveBeenCalledWith(expect.stringContaining("does not reconcile"));
});
it("keeps genuine cancellation adjustments in cancellation reconciliation", async () => {
  tables.order_adjustments = [{ id: "cancel", restaurant_id: "r", order_id: "o", kind: "cancel", previous_total: 80 }];
  tables.user_logs = []; orders[0].status = "cancelled";
  const result = await check(); expect(result.cancelled.has("o")).toBe(true);
  expect(bad).toHaveBeenCalledWith("cancelled order o lacks a return obligation");
});
it("accepts a rest operation that writes off only whole orders", async () => {
  tables.order_adjustments = []; tables.user_logs[0].detail = "kind=rest amount=50 currency=MXN";
  await check(); expect(bad).not.toHaveBeenCalled();
});
it("matches PostgreSQL's cents at a binary half-cent such as 1.005", async () => {
  Object.assign(tables.order_adjustments[0], { previous_total: "1.005", resulting_total: 1, forgiven: 0.01 });
  orders[0].total = 1; payments[0].amount = 1; tables.payment_allocations[0].amount = 1;
  tables.orders = []; tables.user_logs[0].detail = "kind=rest amount=0.01 currency=MXN";
  await check(); expect(bad).not.toHaveBeenCalled();
});

it.each([30, 80])("accepts forgiveness followed by returns of %s, preserving the loss event", async amount => {
  orders[0].total = 80 - amount;
  tables.order_adjustments.push({ id: "return-adjustment", restaurant_id: "r", order_id: "o", kind: "return",
    previous_total: 80, resulting_total: 80 - amount, previous_tip: 0, resulting_tip: 0, currency: "MXN" });
  tables.refund_allocations = [{ allocation_id: "a", operation_id: "return-operation", amount, tip: 0 }];
  tables.refund_operations = [{ id: "return-operation", restaurant_id: "r", adjustment_id: "return-adjustment",
    source: "cash", amount, tip: 0, status: "succeeded", completed_at: "2026-10-29T12:00:00Z" }];
  await check(); expect(bad).not.toHaveBeenCalled();
});

it("subtracts multiple return and tip deltas only from the forgiven order they belong to", async () => {
  orders[0].total = 45; orders[0].tip = 5;
  payments[0].tip = 10; tables.payment_allocations[0].tip = 10;
  Object.assign(tables.order_adjustments[0], { previous_tip: 10, resulting_tip: 10 });
  tables.order_adjustments.push(
    { id: "r1", restaurant_id: "r", order_id: "o", kind: "return", previous_total: 80, resulting_total: 60, previous_tip: 10, resulting_tip: 5 },
    { id: "r2", restaurant_id: "r", order_id: "o", kind: "return", previous_total: 60, resulting_total: 45, previous_tip: 5, resulting_tip: 5 },
    { id: "other", restaurant_id: "r", order_id: "other", kind: "return", previous_total: 100, resulting_total: 0, previous_tip: 0, resulting_tip: 0 },
  );
  tables.refund_allocations = [{ allocation_id: "a", operation_id: "op1", amount: 20, tip: 5 },
    { allocation_id: "a", operation_id: "op2", amount: 15, tip: 0 }];
  tables.refund_operations = [{ id: "op1", source: "cash", amount: 20, tip: 5, status: "succeeded", completed_at: "2026-10-29T12:00:00Z" },
    { id: "op2", source: "cash", amount: 15, tip: 0, status: "succeeded", completed_at: "2026-10-30T12:00:00Z" }];
  await check(); expect(bad).not.toHaveBeenCalled();
  orders[0].total = 46;
  await check(); expect(bad).toHaveBeenCalledWith("forgiven order o lacks resulting coverage");
});
