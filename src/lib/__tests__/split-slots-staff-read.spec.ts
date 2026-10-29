import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ actor: { restaurantId: "restaurant" } as { restaurantId: string } | null,
  stamp: "now" as string | null, paid: true, held: true, fail: false, filters: [] as unknown[][] }));
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => state.actor }));
vi.mock("@/lib/api-error", () => ({ apiError: async (_key: string, status: number) => new Response("{}", { status }) }));
vi.mock("@/lib/bill-data", () => ({ fetchTableBill: async () => [{ id: "order", session_id: "session", currency: "MXN", total: 100, collected: 50, status: "received", items: [] }] }));
vi.mock("@/lib/table-outstanding", () => ({ tableOutstanding: async () => ({ owed: 50, orders: [{ session_id: "session" }], sittings: [] }) }));
vi.mock("@/lib/part-payment", () => ({ summary: (v: unknown) => v }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const q: Record<string, unknown> = {};
  for (const op of ["select", "eq", "in", "order"]) q[op] = (...args: unknown[]) => { state.filters.push([table, op, ...args]); return q; };
  const data = table === "bill_splits" ? [{ id: "split", session_id: "session", model_version: 2, revision: 3, status: "locked",
    order_ids: ["first", "second"], shares: 2, amount: 100, proposed_by: "member", currency: "MXN", first_payment_attempt_at: state.stamp }] : [
      { share_no: 0, amount_cents: 5000, fee_slice_cents: 150, payment_id: state.paid ? "receipt" : null, reserved_checkout_id: null },
      { share_no: 1, amount_cents: 5000, fee_slice_cents: 150, payment_id: null, reserved_checkout_id: state.held ? "private-checkout" : null },
    ];
  q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: state.fail ? { message: "read failed" } : null }).then(resolve);
  return q;
} }) }));
const { GET } = await import("@/app/api/table-bill/route");
beforeEach(() => { state.actor = { restaurantId: "restaurant" }; state.stamp = "now"; state.paid = true; state.held = true; state.fail = false; state.filters = []; });
const request = () => new NextRequest("http://localhost/api/table-bill?tableId=table");
it("gives front of house the paid and held slots without private checkout ids", async () => {
  const res = await GET(request()), body = await res.json();
  expect(res.status).toBe(200);
  expect(body.splits).toEqual([expect.objectContaining({ id: "split", restaurantId: "restaurant", tableId: "table", sessionId: "session", revision: 3,
    modelVersion: 2, orderIds: ["first", "second"], frozen: true, slots: [expect.objectContaining({ paid: true, paying: false }), expect.objectContaining({ paid: false, paying: true })] })]);
  expect(JSON.stringify(body.splits)).not.toContain("private-checkout");
  expect(state.filters).toContainEqual(["bill_splits", "eq", "restaurant_id", "restaurant"]);
  expect(state.filters).toContainEqual(["bill_splits", "in", "session_id", ["session"]]);
});
it("refuses the kitchen before any split read", async () => {
  state.actor = null; expect((await GET(request())).status).toBe(403); expect(state.filters).toEqual([]);
});
it("a failed slot read never becomes permission to collect the whole bill", async () => {
  state.fail = true; expect((await GET(request())).status).toBe(500);
});

it.each([[true, false], [false, true], [false, false]])("staff freezes for paid=%s held=%s without an attempt timestamp", async (paid, held) => {
  state.stamp = null; state.paid = paid; state.held = held;
  const body = await (await GET(request())).json();
  expect(body.splits[0].frozen).toBe(paid || held);
});
