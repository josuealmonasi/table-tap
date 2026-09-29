import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Switching the service charge off takes it off the bills still open — and
 * off nothing whose total is already promised to somebody.
 *
 * The live demo's Mesa 8 owed MX$4.40 for a MX$4.00 salad after the owner had
 * switched the charge off: it was stored on the order when it was placed.
 */

type Answer = { data: unknown; error: { message: string } | null };
const tables: Record<string, Answer> = {};
const updates: { id: string; values: Record<string, unknown> }[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      let updating: Record<string, unknown> | null = null;
      let id = "";
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "not", "is", "gt", "in"]) builder[m] = () => builder;
      builder.eq = (col: string, value: string) => {
        if (col === "id") id = value;
        return builder;
      };
      builder.update = (values: Record<string, unknown>) => {
        updating = values;
        return builder;
      };
      builder.then = (resolve: (a: Answer) => unknown, reject: (e: unknown) => unknown) => {
        if (updating) {
          updates.push({ id, values: updating });
          return Promise.resolve({ data: [{ id }], error: null }).then(resolve, reject);
        }
        return Promise.resolve(tables[table] ?? { data: [], error: null }).then(resolve, reject);
      };
      return builder;
    },
  }),
}));

const { repricedService, repriceOpenService } = await import("@/lib/service-reprice");

const open = (id: string, extra: Record<string, unknown> = {}) => ({
  id, subtotal: 4, service_fee: 0.4, total: 4.4, session_id: null, card_checkout_at: null, ...extra,
});

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  updates.length = 0;
});

describe("the arithmetic", () => {
  it("takes the charge off entirely when it is switched off", () => {
    expect(repricedService({ subtotal: 4, service_fee: 0.4, total: 4.4 }, 0)).toEqual({ service_fee: 0, total: 4 });
  });

  it("lowers it to the new percentage, on the discounted subtotal", () => {
    expect(repricedService({ subtotal: 10, service_fee: 1, total: 12.5 }, 5)).toEqual({ service_fee: 0.5, total: 12 });
  });

  it("never raises it — the diner saw the price when they ordered", () => {
    expect(repricedService({ subtotal: 4, service_fee: 0, total: 4 }, 10)).toBeNull();
    expect(repricedService({ subtotal: 4, service_fee: 0.4, total: 4.4 }, 15)).toBeNull();
    expect(repricedService({ subtotal: 4, service_fee: 0.4, total: 4.4 }, 10)).toBeNull();
  });
});

describe("the open bills", () => {
  it("lowers an open bill nobody has started paying", async () => {
    tables.orders = { data: [open("salad"), open("pie", { subtotal: 6, service_fee: 0.6, total: 6.6 })], error: null };
    await expect(repriceOpenService("r1", 0)).resolves.toBe(2);
    expect(updates).toEqual([
      { id: "salad", values: { service_fee: 0, total: 4 } },
      { id: "pie", values: { service_fee: 0, total: 6 } },
    ]);
  });

  it("leaves an order with money against it, or on a sitting that has some", async () => {
    tables.orders = { data: [open("paid-part"), open("on-sitting", { session_id: "s1" })], error: null };
    tables.payments = { data: [{ order_id: "paid-part", session_id: "s1" }], error: null };
    await expect(repriceOpenService("r1", 0)).resolves.toBe(0);
    expect(updates).toEqual([]);
  });

  it("leaves a bill being divided", async () => {
    tables.orders = { data: [open("shared", { session_id: "s2" })], error: null };
    tables.bill_splits = { data: [{ session_id: "s2" }], error: null };
    await expect(repriceOpenService("r1", 0)).resolves.toBe(0);
  });

  it("leaves one named in a discount or a write-off a manager has not decided", async () => {
    tables.orders = { data: [open("asked"), open("walked")], error: null };
    tables.discount_requests = { data: [{ order_ids: ["asked"] }], error: null };
    tables.write_off_requests = { data: [{ order_ids: ["walked"] }], error: null };
    await expect(repriceOpenService("r1", 0)).resolves.toBe(0);
  });

  it("leaves one whose card checkout is still open, and lowers it once that has expired", async () => {
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    tables.orders = { data: [open("paying", { card_checkout_at: now }), open("walked-away", { card_checkout_at: old })], error: null };
    await expect(repriceOpenService("r1", 0)).resolves.toBe(1);
    expect(updates.map(u => u.id)).toEqual(["walked-away"]);
  });

  it("says it could not tell, rather than lowering blind, when a read fails", async () => {
    tables.orders = { data: [open("salad")], error: null };
    tables.payments = { data: null, error: { message: "timeout" } };
    await expect(repriceOpenService("r1", 0)).resolves.toBeNull();
    expect(updates).toEqual([]);
  });
});
