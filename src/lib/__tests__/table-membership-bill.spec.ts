import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/table-session", () => ({
}));
vi.mock("@/lib/payment-coverage", () => ({ paymentCoverageDetails: async () => new Map() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const predicates: ((row: Record<string, unknown>) => boolean)[] = [];
      const q: Record<string, unknown> = {};
      for (const name of ["select", "neq", "is", "gte", "order"]) q[name] = (...args: unknown[]) => { filters.push([name, ...args]); return q; };
      q.eq = (field: string, value: unknown) => {
        filters.push(["eq", field, value]);
        predicates.push(row => row[field] === value);
        return q;
      };
      q.in = (field: string, values: unknown[]) => {
        predicates.push(row => values.includes(row[field]));
        return q;
      };
      q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({
        data: (tables[table] ?? []).filter(row => predicates.every(predicate => predicate(row))), error: null,
      }).then(resolve);
      return q;
    },
  }),
}));

const filters: unknown[] = [];
const tables: Record<string, Record<string, unknown>[]> = {};
const { fetchTableBill } = await import("@/lib/bill-data");

describe("a saved table QR is not membership", () => {
  it("never falls back from an earlier sitting to the next party's bill", async () => {
    expect(await fetchTableBill("r", "t", "diner", "earlier-party")).toEqual([]);
  });
  it("never hands the current bill to a phone with only the printed table id", async () => {
    expect(await fetchTableBill("r", "t")).toEqual([]);
  });
});

it("keeps a closed member's food visible for payment without reading the next party", async () => {
  filters.length = 0;
  await fetchTableBill("r", "t", "diner", "earlier-party", {
    id: "member", restaurantId: "r", tableId: "t", sessionId: "earlier-party", closed: true,
  });
  expect(filters).toContainEqual(["eq", "session_id", "earlier-party"]);
  expect(filters).toContainEqual(["eq", "diner", "member"]);
});

it("keeps the table's unpaid bill and returns paid order IDs only to their owner or payer", async () => {
  const scope = { restaurant_id: "r", table_id: "t", session_id: "session" };
  tables.orders = [
    { id: "own", diner: "member", paid: true },
    { id: "other-paid", diner: "other", paid: true },
    { id: "paid-for", diner: "other", paid: true },
    { id: "other-owed", diner: "other", paid: false },
  ].map(order => ({ ...scope, written_off: false, status: "received", total: 100, ...order }));
  tables.payments = [{ ...scope, order_id: "paid-for", stripe_payment_intent: "pi_paid" }];
  tables.diner_checkouts = [{ restaurant_id: "r", stripe_payment_intent: "pi_paid", split_id: null, payer_member_id: "member" }];
  const rows = await fetchTableBill("r", "t", "diner", "session", {
    id: "member", restaurantId: "r", tableId: "t", sessionId: "session", closed: false,
  });
  expect(rows.map(row => row.id)).toEqual(["other-owed", "own", "paid-for"]);
  expect((await fetchTableBill("r", "t", "staff")).map(row => row.id)).toEqual(["other-owed", "own", "other-paid", "paid-for"]);
});
