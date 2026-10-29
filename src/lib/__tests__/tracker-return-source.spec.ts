import { beforeEach, expect, it, vi } from "vitest";
import { returnFixture, ORDER } from "./returns-contract-fixtures";
const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));
import { fetchTrackedOrder } from "@/lib/order-tracking";
let fixture: ReturnType<typeof returnFixture>;
beforeEach(() => {
  fixture = returnFixture(); db.from.mockImplementation(fixture.from);
  db.rpc.mockResolvedValue({ data: { outstanding_cents: 1000 }, error: null });
  fixture.tables.orders[0].total = 30;
  fixture.tables.order_adjustments = [{ id: "return", kind: "return", order_id: ORDER, restaurant_id: "r1", currency: "MXN",
    previous_total: 80, resulting_total: 30, previous_tip: 10, resulting_tip: 10, previous_service_fee: 0, resulting_service_fee: 0 }];
  fixture.tables.refund_operations = [{ id: "partial", restaurant_id: "r1", adjustment_id: "return", source: "stripe", amount: 50,
    tip: 0, currency: "MXN", status: "processing", completed_at: null }];
});
it("the tracker distinguishes paid money from completed and pending returns just like the receipt", async () => {
  expect(await fetchTrackedOrder(ORDER)).toMatchObject({ total: 30, returnSummary: { paid: 80, returned: 40, pending: 10 } });
});
it("a failed partial return read cannot invent a paid total for the tracker", async () => {
  db.rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });
  await expect(fetchTrackedOrder(ORDER)).rejects.toThrow();
});
it("keeps paid money visible after a full return", async () => {
  fixture.tables.orders[0].total = 0;
  fixture.tables.order_adjustments[0].resulting_total = 0;
  fixture.tables.refund_operations[0].amount = 80;
  fixture.tables.refund_operations[0].status = "succeeded";
  expect(await fetchTrackedOrder(ORDER)).toMatchObject({ total: 0, returnSummary: { paid: 80, returned: 80, pending: 0 } });
});
it("keeps an unchanged bill without return rows", async () => {
  fixture.tables.order_adjustments = [];
  expect((await fetchTrackedOrder(ORDER))?.returnSummary).toBeUndefined();
});
it("refuses a return reduction that raced the order read", async () => {
  fixture.tables.orders[0].total = 80;
  await expect(fetchTrackedOrder(ORDER)).rejects.toThrow("sale changed");
});
