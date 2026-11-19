import { beforeEach, expect, it, vi } from "vitest";
import { returnFixture } from "./returns-contract-fixtures";
import { eventQuery } from "./return-events-fixture";

const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));
import { collectedToday } from "@/lib/collected-today";
import { readReturnEvents } from "@/lib/refunds/events";

const start = "2026-11-13T06:00:00.000Z", end = "2026-11-14T06:00:00.000Z";
let fixture: ReturnType<typeof returnFixture>;
beforeEach(() => {
  vi.clearAllMocks(); fixture = returnFixture();
  fixture.tables.return_events = [
    { id: "manual", operation_id: "partial", restaurant_id: "r1", currency: "MXN", source: "stripe", amount_cents: 4000,
      succeeded_at: start, historical_log_id: null },
    { id: "remainder", operation_id: "partial", restaurant_id: "r1", currency: "MXN", source: "stripe", amount_cents: 6000,
      succeeded_at: end, historical_log_id: null },
  ];
  db.from.mockImplementation(fixture.from);
  db.rpc.mockImplementation((name, args) => {
    if (name !== "order_return_events_v1") throw new Error("unexpected RPC");
    const query = eventQuery(fixture, args);
    // The mock checks the boundary contract; SQL pins prove where it is applied.
    if (args.p_from) query.gte("succeeded_at", args.p_from);
    if (args.p_to && args.p_to !== "infinity") query.lt("succeeded_at", args.p_to);
    return query;
  });
});

it("passes today's start into SQL instead of materializing the whole history", async () => {
  expect(await collectedToday("r1", "MXN", new Date(start))).toBe(-100);
  expect(db.rpc).toHaveBeenCalledWith("order_return_events_v1", {
    p_restaurant: "r1", p_currency: "MXN", p_from: start, p_to: "infinity",
  });
});

it("keeps successful partials on their own day with an exclusive upper bound", async () => {
  expect(await readReturnEvents(db as never, "r1", start, end, { currency: "MXN" }))
    .toEqual([fixture.tables.return_events[0]]);
  expect(db.rpc).toHaveBeenCalledWith("order_return_events_v1", {
    p_restaurant: "r1", p_currency: "MXN", p_from: start, p_to: end,
  });
});

it("keeps the legacy inclusive-end reader on its existing signature", async () => {
  expect(await readReturnEvents(db as never, "r1", start, end, { inclusiveEnd: true })).toHaveLength(2);
  expect(db.rpc).toHaveBeenCalledWith("order_return_events_v1", { p_restaurant: "r1", p_currency: null });
});
