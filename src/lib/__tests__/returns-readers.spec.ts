import { beforeEach, expect, it, vi } from "vitest";
import { completedEventQuery } from "./return-events-fixture";
import { returnFixture } from "./returns-contract-fixtures";
import type { createAdminClient } from "@/lib/supabase/admin";
import { withReturnComponents } from "@/lib/return-components";
import { computeAnalytics } from "@/lib/analytics";
import { saleReturnSummary } from "@/lib/refunds/reporting";
let fixture: ReturnType<typeof returnFixture>;
const db = () => ({ ...fixture, rpc: (name: string, args: { p_restaurant: string; p_currency: string | null }) =>
  name === "order_return_events_v1" ? completedEventQuery(fixture, args) : fixture.rpc(name, args),
}) as unknown as ReturnType<typeof createAdminClient>;
beforeEach(() => { fixture = returnFixture(); });
it("restores original sales, ticket averages, food contribution and sold units without restoring forgiven money", async () => {
  fixture.tables.order_adjustments = [{ id: "return", restaurant_id: "r1", order_id: "sale", kind: "return", currency: "USD",
    previous_total: 80, resulting_total: 30, previous_tip: 10, resulting_tip: 10, previous_service_fee: 0, resulting_service_fee: 0 },
    { id: "loss", restaurant_id: "r1", order_id: "sale", kind: "forgive", currency: "USD", previous_total: 100, resulting_total: 80 }];
  const rows = await withReturnComponents(db(), "r1", [{ id: "sale", currency: "USD", total: 30, tip: 10, service_fee: 0,
    created_at: "2026-10-27T18:00:00Z", items: [{ itemId: "dish", name: "Dish", emoji: "", qty: 1, price: 90, mods: {} }] }]);
  const data = computeAnalytics(rows, "today", "UTC", new Date("2026-10-27T20:00:00Z"), "en");
  expect(data).toMatchObject({ revenue: 80, avgTicket: 80, tips: 10, orderCount: 1, topProducts: [{ qty: 1, revenue: 70 }] });
});
it("counts completed returns in [start, end), and shows only outstanding pending money separately", async () => {
  fixture.tables.refund_operations = [
    { id: "before", restaurant_id: "r1", currency: "MXN", "order_adjustments.kind": "return", status: "succeeded", amount: 40, completed_at: "2026-10-29T05:59:00Z" },
    { id: "midnight", restaurant_id: "r1", currency: "MXN", "order_adjustments.kind": "return", status: "succeeded", amount: 10, completed_at: "2026-10-29T06:00:00Z" },
    { id: "pending", restaurant_id: "r1", currency: "MXN", "order_adjustments.kind": "return", status: "processing", amount: 100, completed_at: null },
    { id: "foreign", restaurant_id: "r2", currency: "MXN", "order_adjustments.kind": "return", status: "succeeded", amount: 999, completed_at: "2026-10-29T05:59:00Z" },
    { id: "usd", restaurant_id: "r1", currency: "USD", "order_adjustments.kind": "return", status: "succeeded", amount: 999, completed_at: "2026-10-29T05:59:00Z" },
  ];
  fixture.rpc.mockResolvedValue({ data: { outstanding_cents: 6000 }, error: null });
  expect(await saleReturnSummary(db(), "r1", "MXN", "2026-10-28T06:00:00Z", "2026-10-29T06:00:00Z"))
    .toEqual({ completed: 40, pending: 60 });
});
it("refuses components from a reduction racing the sale read", async () => {
  fixture.tables.order_adjustments = [{ id: "return", restaurant_id: "r1", order_id: "sale", kind: "return", currency: "MXN",
    previous_total: 80, resulting_total: 30, previous_tip: 10, resulting_tip: 10, previous_service_fee: 0, resulting_service_fee: 0 }];
  await expect(withReturnComponents(db(), "r1", [{ id: "sale", total: 80, tip: 10, service_fee: 0, currency: "MXN" }])).rejects.toThrow("sale changed");
});
it("throws on a failed return read instead of declaring a zero return day", async () => {
  vi.spyOn(fixture, "from").mockImplementation(() => { throw new Error("unavailable"); });
  await expect(saleReturnSummary(db(), "r1", "MXN", "start", "end")).rejects.toThrow("unavailable");
});
