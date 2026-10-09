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

/** Every database function called, with what it was handed. */
const rpcs: { fn: string; args: Record<string, unknown> }[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return (script[`rpc:${fn}`] ?? []).shift() ?? { data: null, error: null };
    },
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

const closeSessions = vi.fn();
vi.mock("@/lib/table-session", () => ({ closeSessionsFor: (...args: unknown[]) => closeSessions(...args) }));
vi.mock("@/lib/stock-service", () => ({ releaseStock: async () => {} }));

const { settleCheckout } = await import("@/lib/checkout-settle");

const down = { data: null, count: null, error: { message: "canceling statement due to statement timeout" } };
const session = (metadata: Record<string, string>) =>
  ({ payment_status: "paid", payment_intent: "pi_test", metadata }) as unknown as Stripe.Checkout.Session;
const writes = (table: string) => ops.filter(o => o.table === table && o.op === "update");

const settledAs = (ids: string[]) => ({ data: { settled: ids, tip_on: ids[0] ?? null, not_settled: [] }, error: null });

beforeEach(() => {
  closeSessions.mockReset().mockResolvedValue(undefined);
  ops.length = 0;
  rpcs.length = 0;
  for (const k of Object.keys(script)) delete script[k];
});

describe("a pay-now order", () => {
  it("throws when settling it fails, so Stripe sends the event again", async () => {
    script["rpc:settle_card_orders"] = [down];
    await expect(settleCheckout(session({ order_id: "o1" }))).rejects.toThrow("could not mark it paid");
    expect(ops.filter(o => o.op !== "select")).toEqual([]);
  });

  it("settles it and records its payment in one call, stamped with the payment", async () => {
    script["rpc:settle_card_orders"] = [settledAs(["o1"])];
    await settleCheckout(session({ order_id: "o1" }));
    expect(rpcs).toEqual([{ fn: "settle_card_orders", args: expect.objectContaining({
      p_orders: ["o1"], p_intent: "pi_test", p_status: "received",
    }) }]);
    // Nothing marks it paid or writes the ledger outside that call.
    expect(writes("orders")).toEqual([]);
    expect(ops.filter(o => o.table === "payments")).toEqual([]);
  });
});

describe("a table's bill", () => {
  it("throws when settling it fails, and writes nothing", async () => {
    script["rpc:settle_card_orders"] = [down];
    await expect(settleCheckout(session({ settle_order_ids: "o1,o2" }))).rejects.toThrow("could not mark it paid");
    expect(writes("orders")).toEqual([]);
  });

  it("hands the gratuity to the same call that records the money", async () => {
    script["rpc:settle_card_orders"] = [settledAs(["o1", "o2"])];
    await settleCheckout(session({ settle_order_ids: "o1,o2", settle_tip: "7.5" }));
    expect(rpcs[0]).toEqual({ fn: "settle_card_orders", args: expect.objectContaining({
      p_orders: ["o1", "o2"], p_tip: 7.5, p_tip_order: "o1", p_status: null,
    }) });
    // The tip is not added to an order a second time out here.
    expect(writes("orders").filter(o => JSON.stringify(o.values).includes('"tip"'))).toEqual([]);
  });
});

describe("one diner's share of a divided bill", () => {
  const SPLIT = { id: "s1", restaurant_id: "r1", session_id: "t1", shares: 2, status: "locked", locked_at: "2026-09-24T12:00:00Z" };
  const share = session({ split_id: "s1", split_share: "0", split_amount: "100", settle_tip: "10" });

  it("throws when the split cannot be read, before anything is written", async () => {
    script["bill_splits:select"] = [down];
    await expect(settleCheckout(share)).rejects.toThrow("could not read the split");
    expect(ops.filter(o => o.op !== "select")).toEqual([]);
    expect(rpcs).toEqual([]);
  });

  it("claims the share and records it with its tip in one call", async () => {
    script["bill_splits:select"] = [{ data: SPLIT, error: null }];
    script["rpc:settle_split_share"] = [{ data: true, error: null }];
    script["bill_split_claims:select"] = [{ count: 1, error: null }];
    await settleCheckout(share);
    expect(rpcs[0]).toEqual({ fn: "settle_split_share", args: {
      p_split: "s1", p_share: 0, p_amount: 100, p_tip: 10, p_intent: "pi_test",
    } });
    expect(writes("bill_split_claims")).toEqual([]);
  });

  it("throws when the share cannot be claimed", async () => {
    script["bill_splits:select"] = [{ data: SPLIT, error: null }];
    script["rpc:settle_split_share"] = [down];
    await expect(settleCheckout(share)).rejects.toThrow("could not mark it paid");
    expect(writes("orders")).toEqual([]);
  });

  it("finishes additional orders on retry after the share has already landed", async () => {
    const withFood = session({ ...share.metadata, settle_order_ids: "o2" });
    script["bill_splits:select"] = [{ data: SPLIT, error: null }, { data: SPLIT, error: null }];
    script["rpc:settle_split_share"] = [{ data: true, error: null }, { data: false, error: null }];
    script["rpc:settle_card_orders"] = [down, settledAs(["o2"])];
    script["bill_split_claims:select"] = [{ count: 1, error: null }];
    await expect(settleCheckout(withFood)).rejects.toThrow("could not mark it paid");
    await settleCheckout(withFood);
    expect(rpcs.filter(r => r.fn === "settle_card_orders")).toHaveLength(2);
    expect(rpcs.at(-1)?.args.p_orders).toEqual(["o2"]);
  });

  it("closes the bill when the last share is paid", async () => {
    script["bill_splits:select"] = [{ data: SPLIT, error: null }];
    script["rpc:settle_split_share"] = [{ data: true, error: null }];
    script["bill_split_claims:select"] = [{ count: 0, error: null }];
    await settleCheckout(share);
    expect(writes("orders").some(o => JSON.stringify(o.values).includes('"paid":true'))).toBe(true);
    expect(writes("bill_splits").some(o => JSON.stringify(o.values).includes('"done"'))).toBe(true);
  });

  it("closes it on a repeated delivery too, when the first one's close failed", async () => {
    script["bill_splits:select"] = [{ data: SPLIT, error: null }];
    script["rpc:settle_split_share"] = [{ data: false, error: null }]; // already claimed
    script["bill_split_claims:select"] = [{ count: 0, error: null }];
    await settleCheckout(share);
    expect(writes("orders").some(o => JSON.stringify(o.values).includes('"paid":true'))).toBe(true);
  });

  it("retries closing the sitting even when its orders were already marked paid", async () => {
    script["bill_splits:select"] = [{ data: SPLIT, error: null }, { data: SPLIT, error: null }];
    script["rpc:settle_split_share"] = [{ data: true, error: null }, { data: false, error: null }];
    script["bill_split_claims:select"] = [{ count: 0, error: null }, { count: 0, error: null }];
    script["orders:update"] = [{ data: [{ session_id: SPLIT.session_id }], error: null }, { data: [], error: null }];
    script["bill_splits:update"] = [down, { error: null }];
    await expect(settleCheckout(share)).rejects.toThrow("could not finish the split");
    await settleCheckout(share);
    expect(closeSessions).toHaveBeenCalledWith([{ session_id: SPLIT.session_id }], "paid");
  });

  it("throws when closing the bill fails, so Stripe sends the event again", async () => {
    script["bill_splits:select"] = [{ data: SPLIT, error: null }];
    script["rpc:settle_split_share"] = [{ data: true, error: null }];
    script["bill_split_claims:select"] = [{ count: 0, error: null }];
    script["orders:update"] = [down];
    await expect(settleCheckout(share)).rejects.toThrow("could not close the divided bill");
  });

  it("leaves the bill open when the unpaid shares cannot be counted — never marks the food paid", async () => {
    script["bill_splits:select"] = [{ data: SPLIT, error: null }];
    script["rpc:settle_split_share"] = [{ data: true, error: null }];
    script["bill_split_claims:select"] = [down];
    await expect(settleCheckout(share)).rejects.toThrow("could not count the unpaid shares");
    expect(writes("orders").filter(o => JSON.stringify(o.values).includes('"paid":true'))).toEqual([]);
    expect(writes("bill_splits")).toEqual([]);
  });
});
