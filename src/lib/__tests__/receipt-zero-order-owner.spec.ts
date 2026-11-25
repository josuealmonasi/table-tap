import { expect, it } from "vitest";
import { ownPaidOrderIds } from "@/lib/receipt-payment-owners";

// The whole-bill payer was refused the receipt when one order on the bill had
// nothing left to charge: it gets no payments row, so it failed the check.
type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

function fakeDb(tables: Record<string, Row[]>) {
  const calls: { table: string; filters: string[] }[] = [];
  const from = (table: string) => {
    const filters: Filter[] = [];
    const call = { table, filters: [] as string[] };
    calls.push(call);
    const q: Record<string, unknown> = {};
    const add = (name: string, f: Filter) => { call.filters.push(name); filters.push(f); return q; };
    q.select = () => q;
    q.eq = (col: string, v: unknown) => add(`eq:${col}`, r => r[col] === v);
    q.is = (col: string, v: unknown) => add(`is:${col}`, r => (r[col] ?? null) === v);
    q.in = (col: string, vs: unknown[]) => add(`in:${col}`, r => vs.includes(r[col]));
    q.overlaps = (col: string, vs: unknown[]) => add(`overlaps:${col}`, r => (r[col] as unknown[]).some(x => vs.includes(x)));
    q.then = (resolve: (v: unknown) => void) => resolve({ data: (tables[table] ?? []).filter(r => filters.every(f => f(r))), error: null });
    return q;
  };
  return { db: { from } as never, calls };
}

const base = {
  payments: [{ order_id: "charged", stripe_payment_intent: "pi_1", restaurant_id: "r1", session_id: "s1" }],
  orders: [
    { id: "charged", restaurant_id: "r1", session_id: "s1" },
    { id: "zero", restaurant_id: "r1", session_id: "s1" },
    { id: "other-sitting", restaurant_id: "r1", session_id: "s2" },
  ],
};
const page = (extra: Row): Row => ({
  stripe_payment_intent: "pi_1", restaurant_id: "r1", status: "paid", payer_member_id: "m1", split_id: null,
  payable_order_ids: ["charged", "zero", "other-sitting"], ...extra,
});

it("an order with nothing to charge on the member's paid whole-bill page is theirs", async () => {
  const { db } = fakeDb({ ...base, diner_checkouts: [page({})] });
  const own = await ownPaidOrderIds(db, "r1", "s1", "m1", ["charged", "zero"]);
  expect([...own].sort()).toEqual(["charged", "zero"]);
});

it("never from an open, split, foreign-member or other-restaurant page", async () => {
  for (const extra of [{ status: "open" }, { split_id: "split-1" }, { payer_member_id: "m2" }, { restaurant_id: "r2" }]) {
    const { db } = fakeDb({ ...base, diner_checkouts: [page(extra)] });
    const own = await ownPaidOrderIds(db, "r1", "s1", "m1", ["zero"]);
    expect(own.has("zero"), JSON.stringify(extra)).toBe(false);
  }
});

it("never for an order in another sitting, even on the member's paid page", async () => {
  const { db } = fakeDb({ ...base, diner_checkouts: [page({})] });
  const own = await ownPaidOrderIds(db, "r1", "s1", "m1", ["other-sitting"]);
  expect(own.size).toBe(0);
});

it("skips the extra lookup when every order already has the member's payment", async () => {
  const { db, calls } = fakeDb({ ...base, diner_checkouts: [page({})] });
  await ownPaidOrderIds(db, "r1", "s1", "m1", ["charged"]);
  expect(calls.some(c => c.filters.includes("overlaps:payable_order_ids"))).toBe(false);
});
