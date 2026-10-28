import { beforeEach, expect, it, vi } from "vitest";
import { returnFixture } from "./returns-contract-fixtures";
import { eventQuery } from "./return-events-fixture";
import { saleReturnSummary } from "@/lib/refunds/reporting";
import { corteFrom } from "@/lib/corte";
import { readReceiptReturns } from "@/lib/receipt-return-source";
const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));
import { returnedAdjustments } from "@/lib/refunds/adjustments";
let f: ReturnType<typeof returnFixture>;
const start = "2026-10-28T06:00:00Z", midnight = "2026-10-29T06:00:00Z", end = "2026-10-30T06:00:00Z";
beforeEach(() => {
  f = returnFixture(); db.from.mockImplementation(f.from);
  db.rpc.mockImplementation((name, args) => name === "order_return_events_v1" ? eventQuery(f, args)
    : Promise.resolve({ data: { outstanding_cents: f.tables.refund_operations[0].status === "succeeded" ? 0 : 6000 }, error: null }));
  f.tables.refund_operations = [{ id: "op", adjustment_id: "adjustment", restaurant_id: "r1", currency: "MXN",
    "order_adjustments.kind": "return", source: "stripe", amount: 100, status: "processing", completed_at: null }];
  f.tables.return_events = [{ id: "manual-refund", operation_id: "op", order_id: "sale", restaurant_id: "r1", currency: "MXN",
    kind: "return", source: "stripe", amount_cents: 4000, succeeded_at: "2026-10-29T05:59:00Z", payout_actor: null, historical_log_id: null }];
});
const summary = (from: string, to: string) => saleReturnSummary(db as never, "r1", "MXN", from, to);
const corte = async (from: string, to: string) => corteFrom([], await returnedAdjustments("r1", from, to, "MXN"));
it("counts a successful manual partial before the operation completes, matching receipt coverage", async () => {
  const adjustment = { id: "adjustment", order_id: "sale", currency: "MXN", previous_total: 100, resulting_total: 0,
    previous_tip: 0, resulting_tip: 0, previous_service_fee: 0, resulting_service_fee: 0 };
  const receipt = await readReceiptReturns(db as never, "r1", [{ id: "sale", currency: "MXN", total: 100 }], [adjustment]);
  expect(receipt[0].returns?.[0].returned_cents).toBe(4000);
  expect(await summary(start, midnight)).toEqual({ completed: 40, pending: 60 });
  expect(await corte(start, midnight)).toMatchObject({ refunded: 40, online: -40 });
});
it("keeps each refund on its own day after the remaining money succeeds at exact local midnight", async () => {
  f.tables.refund_operations[0].status = "succeeded";
  f.tables.refund_operations[0].completed_at = midnight;
  f.tables.return_events.push({ ...f.tables.return_events[0], id: "app-remainder", amount_cents: 6000, succeeded_at: midnight });
  expect(await summary(start, midnight)).toEqual({ completed: 40, pending: 0 });
  expect(await summary(midnight, end)).toEqual({ completed: 60, pending: 0 });
  expect(await corte(start, midnight)).toMatchObject({ refunded: 40 });
  expect(await corte(midnight, end)).toMatchObject({ refunded: 60 });
});
it("keeps tenant, currency and imported-log deduplication while analytics counts only completed-sale returns", async () => {
  const event = f.tables.return_events[0];
  f.tables.return_events.push({ ...event, id: "foreign", restaurant_id: "r2", amount_cents: 99900 },
    { ...event, id: "usd", currency: "USD", amount_cents: 99900 },
    { ...event, id: "imported", historical_log_id: "old-log", amount_cents: 1000 },
    { ...event, id: "cancel", kind: "cancel", amount_cents: 2000 });
  expect(await summary(start, midnight)).toEqual({ completed: 50, pending: 60 });
  expect(await corte(start, midnight)).toMatchObject({ refunded: 60 });
});
it("fails a financial read when dated evidence is unavailable", async () => {
  db.rpc.mockImplementation((name, args) => name === "order_return_events_v1"
    ? Object.assign(eventQuery(f, args), { range: async () => ({ data: null, error: { message: "unavailable" } }) })
    : Promise.resolve({ data: { outstanding_cents: 6000 }, error: null }));
  await expect(summary(start, midnight)).rejects.toThrow();
});
