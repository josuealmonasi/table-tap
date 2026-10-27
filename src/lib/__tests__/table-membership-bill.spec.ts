import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/table-session", () => ({
}));
vi.mock("@/lib/payment-coverage", () => ({ paymentCoverageDetails: async () => new Map() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      for (const name of ["select", "eq", "neq", "is", "gte", "order"]) q[name] = (...args: unknown[]) => { filters.push([name, ...args]); return q; };
      q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({
        data: [{ id: "strangers-food", status: "received", paid: false, total: 100 }], error: null,
      }).then(resolve);
      return q;
    },
  }),
}));

const filters: unknown[] = [];
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
