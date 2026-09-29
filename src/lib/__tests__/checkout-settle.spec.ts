import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

/**
 * Settling a card payment when the database does not answer.
 *
 * The webhook answers Stripe 200 unless settling throws, and Stripe only sends
 * an event again after a failure. So a write that failed and was read as
 * "nothing to settle" left the diner's money in Stripe, recorded nowhere, with
 * nothing that would ever ask again. And one count read as zero when it had
 * failed closed a divided bill while shares were still owed.
 */

interface Op { table: string; op: "select" | "update" | "insert" | "delete"; values?: unknown }
const ops: Op[] = [];
/** The answers the fake database gives, in order, per `table:op`. */
const script: Record<string, { data?: unknown; count?: number | null; error: { message: string } | null }[]> = {};

function answer(table: string, op: Op["op"]) {
  const queue = script[`${table}:${op}`] ?? [];
  return queue.shift() ?? { data: null, count: null, error: null };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      let op: Op["op"] = "select";
      const builder: Record<string, unknown> = {};
      for (const m of ["eq", "in", "is", "lt", "order", "limit", "select"]) builder[m] = () => builder;
      builder.update = (values: unknown) => { op = "update"; ops.push({ table, op, values }); return builder; };
      builder.insert = (values: unknown) => { op = "insert"; ops.push({ table, op, values }); return builder; };
      builder.delete = () => { op = "delete"; ops.push({ table, op }); return builder; };
      builder.maybeSingle = async () => answer(table, op);
      builder.single = async () => answer(table, op);
      builder.then = (resolve: (a: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(answer(table, op)).then(resolve, reject);
      return builder;
    },
  }),
}));

const recorded: unknown[] = [];
vi.mock("@/lib/payments", () => ({
  recordPayment: async (p: unknown) => { recorded.push(p); return "written"; },
  recordPayments: async (ps: unknown[]) => { recorded.push(...ps); },
}));
vi.mock("@/lib/table-session", () => ({ closeSessionsFor: async () => {} }));
vi.mock("@/lib/stock-service", () => ({ releaseStock: async () => {} }));

const { settleCheckout } = await import("@/lib/checkout-settle");

const down = { data: null, count: null, error: { message: "canceling statement due to statement timeout" } };
const session = (metadata: Record<string, string>) =>
  ({ payment_status: "paid", payment_intent: "pi_test", metadata }) as unknown as Stripe.Checkout.Session;
const writes = (table: string) => ops.filter(o => o.table === table && o.op === "update");

beforeEach(() => {
  ops.length = 0;
  recorded.length = 0;
  for (const k of Object.keys(script)) delete script[k];
});

describe("a pay-now order", () => {
  it("throws when marking it paid fails, so Stripe sends the event again", async () => {
    script["orders:update"] = [down];
    await expect(settleCheckout(session({ order_id: "o1" }))).rejects.toThrow("could not mark it paid");
    expect(recorded).toEqual([]);
  });

  it("records the payment when it is marked paid", async () => {
    script["orders:update"] = [{ data: [{ session_id: null, total: 120, restaurant_id: "r1" }], error: null }];
    await settleCheckout(session({ order_id: "o1" }));
    expect(recorded).toHaveLength(1);
  });
});

describe("a table's bill", () => {
  it("throws when marking it paid fails, and records nothing", async () => {
    script["orders:update"] = [down];
    await expect(settleCheckout(session({ settle_order_ids: "o1,o2" }))).rejects.toThrow("could not mark it paid");
    expect(recorded).toEqual([]);
  });
});

describe("one diner's share of a divided bill", () => {
  const SPLIT = { id: "s1", restaurant_id: "r1", session_id: "t1", shares: 2, status: "locked", locked_at: "2026-09-24T12:00:00Z" };
  const share = session({ split_id: "s1", split_share: "0", split_amount: "100" });

  it("throws when the split cannot be read, before anything is written", async () => {
    script["bill_splits:select"] = [down];
    await expect(settleCheckout(share)).rejects.toThrow("could not read the split");
    expect(ops.filter(o => o.op !== "select")).toEqual([]);
  });

  it("throws when the share cannot be marked paid", async () => {
    script["bill_splits:select"] = [{ data: SPLIT, error: null }];
    script["bill_split_claims:update"] = [down];
    await expect(settleCheckout(share)).rejects.toThrow("could not mark it paid");
    expect(recorded).toEqual([]);
  });

  it("closes the bill when the last share is paid", async () => {
    script["bill_splits:select"] = [{ data: SPLIT, error: null }];
    script["bill_split_claims:update"] = [{ data: [{ share_no: 0 }], error: null }];
    script["bill_split_claims:select"] = [{ count: 0, error: null }];
    await settleCheckout(share);
    expect(writes("orders").some(o => JSON.stringify(o.values).includes('"paid":true'))).toBe(true);
    expect(writes("bill_splits").some(o => JSON.stringify(o.values).includes('"done"'))).toBe(true);
  });

  it("leaves the bill open when the unpaid shares cannot be counted — never marks the food paid", async () => {
    script["bill_splits:select"] = [{ data: SPLIT, error: null }];
    script["bill_split_claims:update"] = [{ data: [{ share_no: 0 }], error: null }];
    script["bill_split_claims:select"] = [down];
    await settleCheckout(share);
    expect(recorded).toHaveLength(1); // this diner's share is still recorded
    expect(writes("orders")).toEqual([]);
    expect(writes("bill_splits")).toEqual([]);
  });
});
