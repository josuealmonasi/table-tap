import { expect, it } from "vitest";
import { journalCents, reconcileAccountJournal, checkAccountJournal } from "../../../scripts/money-account-journal.mjs";

const cutoff = "2026-11-01T00:00:00.000Z", later = "2026-11-02T00:00:00.000Z";
const source = { restaurant_id: "r", account_id: "a", currency: "MXN" };
const movement = (kind: string, amount: number, fields = {}) => ({ ...source, id: kind, kind,
  provenance: "live", amount_cents: amount, tip_cents: 0, service_cents: 0,
  debt_delta_cents: ["credit", "collection"].includes(kind) ? -amount : amount, ...fields });
function fixture() {
  return {
    accounts: [{ id: "a", restaurant_id: "r", journal_started_at: cutoff }],
    orders: [{ ...source, id: "o", charged_at: later, total: 85, tip: 15, service_fee: 0,
      paid: true, written_off: false, status: "completed" }],
    payments: [{ ...source, id: "p", created_at: later, amount: 85, tip: 15,
      account_added_tip_cents: 500, account_tip_order_id: "o", allocation_scope: ["o"] }],
    adjustments: [{ id: "d", restaurant_id: "r", order_id: "o", currency: "MXN", kind: "account_credit",
      created_at: later, amount_cents: 2000, previous_total: 100, resulting_total: 80,
      previous_tip: 10, resulting_tip: 10, previous_service_fee: 0, resulting_service_fee: 0 }],
    movements: [movement("charge", 10000, { order_id: "o", tip_cents: 1000 }),
      movement("credit", 2000, { order_id: "o", adjustment_id: "d" }),
      movement("added_tip", 500, { order_id: "o", payment_id: "p", tip_cents: 500 }),
      movement("collection", 8500, { payment_id: "p", tip_cents: 1500 })],
  };
}
const errors = (data: ReturnType<typeof fixture>): string[] => {
  const found: string[] = [];
  reconcileAccountJournal(data, (message: string) => found.push(message));
  return found;
};
it("restores the original charge and distinguishes old tips from settlement tips", () => {
  expect(errors(fixture())).toEqual([]);
  expect(journalCents("2.675")).toBe(BigInt(268));
  expect(journalCents("1.005")).toBe(BigInt(101));
  expect(journalCents("900719925474099.99")).toBe(BigInt("90071992547409999"));
});
it.each(["charge", "credit", "added_tip", "collection"])("detects a forgotten %s append", kind => {
  const data = fixture(); data.movements = data.movements.filter(m => m.kind !== kind);
  expect(errors(data).length).toBeGreaterThan(0);
});
it("detects duplication and balanced orphan pairs even when debt still nets to zero", () => {
  const data = fixture(); data.movements.push(...data.movements);
  expect(errors(data).some(e => e.includes("duplicated"))).toBe(true);
  const orphan = fixture(); orphan.movements.push(movement("charge", 500, { order_id: "ghost" }),
    movement("collection", 500, { payment_id: "ghost" }));
  expect(errors(orphan).filter(e => e.includes("orphan"))).toHaveLength(2);
});
it("refuses cross-currency netting and component drift", () => {
  const data = fixture(); data.movements[0].currency = "USD";
  expect(errors(data).some(e => e.includes("debt"))).toBe(true);
  const tip = fixture(); tip.movements[2].tip_cents = 0;
  expect(errors(tip).some(e => e.includes("different"))).toBe(true);
});
it("reconciles unpaid cancellation by its unique adjustment", () => {
  const data = fixture(); data.payments = [];
  data.orders[0] = { ...data.orders[0], total: 80, tip: 10, paid: false, status: "cancelled" };
  data.adjustments.push({ ...data.adjustments[0], id: "cancel", kind: "cancel", amount_cents: 8000,
    previous_total: 80, previous_tip: 10 });
  data.movements = data.movements.slice(0, 2);
  data.movements.push(movement("credit", 8000, { id: "cancel", order_id: "o", adjustment_id: "cancel", tip_cents: 1000 }));
  expect(errors(data)).toEqual([]);
  data.movements.pop(); expect(errors(data).length).toBeGreaterThan(0);
});
it("every source read goes through the paginating helper and read errors fail closed", async () => {
  const tables: string[] = [];
  const db = { from: (table: string) => ({ select: () => { tables.push(table); return table; } }) };
  let reads = 0;
  const all = async (build: () => string) => { build(); reads++; return { data: [], error: null }; };
  await checkAccountJournal(db, all, { ok: () => {}, bad: () => {} });
  expect(reads).toBe(5);
  expect(tables.sort()).toEqual(["account_movements", "customer_accounts", "order_adjustments", "orders", "payments"]);
  await expect(checkAccountJournal(db, async () => ({ data: null, error: { message: "denied" } }),
    { ok: () => {}, bad: () => {} })).rejects.toThrow("denied");
});

it("checks opening order components against fabricated tip/collection pairs", () => {
  const data = fixture(); data.adjustments = [];
  data.orders[0] = { ...data.orders[0], charged_at: "2026-10-01T00:00:00.000Z", total: 100, tip: 10 };
  data.payments[0] = { ...data.payments[0], amount: 105, tip: 15 };
  data.movements = [movement("opening", 10000, { provenance: "backfill", tip_cents: 1000,
    charge_snapshot: { orders: [{ order_id: "o", current_total: 100, current_tip: 10, current_service: 0 }] } }),
    movement("added_tip", 500, { order_id: "o", payment_id: "p", tip_cents: 500 }),
    movement("collection", 10500, { payment_id: "p", tip_cents: 1500 })];
  expect(errors(data)).toContain("opening order o differs");
  data.orders[0].total = 105; data.orders[0].tip = 15;
  expect(errors(data)).toEqual([]);
});
it("accepts a zero-cent order's one charge and refuses silently rounded integer inputs", () => {
  const data = fixture(); data.adjustments = []; data.payments = [];
  data.orders[0] = { ...data.orders[0], total: 0, tip: 0, paid: false };
  data.movements = [movement("charge", 0, { order_id: "o" })];
  expect(errors(data)).toEqual([]);
  data.movements[0].amount_cents = Number.MAX_SAFE_INTEGER + 1;
  expect(() => errors(data)).toThrow("unsafe journal integer");
});

it("rejects an added tip outside its independently snapshotted receipt scope", () => {
  const data = fixture(); data.payments[0].allocation_scope = [];
  expect(errors(data)).toContain("account tip source p differs");
});
