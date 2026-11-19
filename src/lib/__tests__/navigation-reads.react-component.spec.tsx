import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const from = vi.fn();
const actor = vi.fn();
vi.mock("@/lib/api-guard", () => ({ actingStaff: () => actor(), actingManager: () => actor() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
import { GET as badges } from "@/app/api/badges/route";
import { GET as notifications, POST as markNotifications } from "@/app/api/notifications/route";

interface ReadResult {
  data?: unknown;
  count?: number | null;
  error: { message: string } | null;
}

function queryResult(result: ReadResult | Promise<ReadResult>) {
  // Supabase queries are awaitable even when the last operation is a filter.
  return Object.assign(Promise.resolve(result), {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result), update: vi.fn().mockReturnThis(),
  });
}

function queue(results: (ReadResult | Promise<ReadResult>)[]): void {
  for (const result of results) from.mockReturnValueOnce(queryResult(result));
}

const badgeReads = (): ReadResult[] => [
  { data: { badges_enabled: true }, error: null },
  ...[2, 3, 4, 5].map(count => ({ count, error: null })),
];

beforeEach(() => {
  vi.resetAllMocks();
  actor.mockResolvedValue({ restaurantId: "r1", role: "owner", email: "owner@example.com" });
});

it.each([0, 1, 2, 3, 4])("refuses a failed badge read at step %s rather than publishing empty or partial counts", async index => {
  const reads = badgeReads();
  reads[index] = { data: null, count: null, error: { message: "database unavailable" } };
  queue(reads);
  const response = await badges();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "apiErr.generic" });
});

it("keeps successful role-scoped badge totals", async () => {
  queue(badgeReads());
  const response = await badges();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ badges: { "/dashboard/orders": 5, "/dashboard/bills": 9 } });
  for (const index of [1, 2]) expect(from.mock.results[index].value.eq).toHaveBeenCalledWith("written_off", false);
  for (const index of [3, 4]) expect(from.mock.results[index].value.eq).not.toHaveBeenCalledWith("written_off", false);
});

it("keeps an explicit disabled setting empty without counting work", async () => {
  queue([{ data: { badges_enabled: false }, error: null }]);
  const response = await badges();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ badges: {} });
  expect(from).toHaveBeenCalledOnce();
});

it.each([0, 1])("refuses a failed notification read at step %s rather than emptying the bell", async index => {
  const reads: ReadResult[] = [{ data: [{ id: "notice" }], error: null }, { count: 3, error: null },
    { data: { timezone: "Asia/Tokyo" }, error: null }, { data: [], error: null }];
  reads[index] = { data: null, count: null, error: { message: "database unavailable" } };
  queue(reads);
  const response = await notifications(new NextRequest("http://localhost/api/notifications"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "apiErr.generic" });
});

it("keeps the notification list and its full unread count", async () => {
  queue([{ data: [{ id: "notice" }], error: null }, { count: 3, error: null }, { data: { timezone: "Asia/Tokyo" }, error: null }, { data: [], error: null }]);
  const response = await notifications(new NextRequest("http://localhost/api/notifications"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ notifications: [{ id: "notice" }], unread: 3, nextCursor: null, timeZone: "Asia/Tokyo" });
});

it("executes only the badge counts each role uses, preserving all five response shapes", async () => {
  const roles = ["waiter", "cashier", "kitchen", "owner", "manager"];
  const results = [];
  for (const role of roles) {
    from.mockReset();
    actor.mockResolvedValue({ restaurantId: "r1", role });
    queue([{ data: { badges_enabled: true }, error: null }, ...Array.from({ length: 4 }, () => ({ count: 7, error: null }))]);
    const response = await badges();
    results.push({ role, status: response.status, body: await response.json(),
      queries: from.mock.calls.slice(1).map(([table], i) => {
        const query = from.mock.results[i + 1].value;
        return { table, select: query.select.mock.calls, eq: query.eq.mock.calls, in: query.in.mock.calls };
      }),
    });
  }
  const count = (table: string, eq: unknown[][], inside: unknown[][] = []) => ({ table,
    select: [["id", { count: "exact", head: true }]], eq: [["restaurant_id", "r1"], ...eq], in: inside });
  const ready = count("orders", [["written_off", false], ["status", "ready"]]);
  const cooking = count("orders", [["written_off", false]], [["status", ["received", "preparing"]]]);
  const approvals = ["discount_requests", "write_off_requests"].map(table => count(table, [["status", "pending"]]));
  expect(results).toEqual(roles.map(role => ({ role, status: 200,
    body: { badges: role === "owner" || role === "manager" ? { "/dashboard/orders": 14, "/dashboard/bills": 14 } : { "/dashboard/orders": 7 } },
    queries: role === "owner" || role === "manager" ? [cooking, ready, ...approvals] : [role === "kitchen" ? cooking : ready],
  })));
});

it.each([
  { restaurant: { data: { timezone: "Asia/Tokyo" }, error: null }, status: 200, timeZone: "Asia/Tokyo" },
  { restaurant: { data: { timezone: null }, error: null }, status: 200, timeZone: "America/Mexico_City" },
  { restaurant: { data: null, error: null }, status: 503, timeZone: undefined },
  { restaurant: { data: null, error: { message: "unavailable" } }, status: 503, timeZone: undefined },
])("starts timezone alongside the held notification reads ($status, $timeZone)", async ({ restaurant, status, timeZone }) => {
  let release!: (value: ReadResult) => void;
  const held = new Promise<ReadResult>(resolve => { release = resolve; });
  const timezoneQuery = queryResult(restaurant);
  const notificationQueries = [held, { count: 3, error: null }, { data: [], error: null }].map(queryResult);
  from.mockImplementation(table => table === "restaurants" ? timezoneQuery : notificationQueries.shift());
  const pending = notifications(new NextRequest("http://localhost/api/notifications"));
  await new Promise<void>(resolve => setImmediate(resolve));
  const started = from.mock.calls.map(([table]) => table);
  const timezoneScope = from.mock.results[2]?.value.eq.mock.calls;
  release({ data: [{ id: "notice" }], error: null });
  const response = await pending;
  expect({ started, timezoneScope, status: response.status, body: await response.json() }).toEqual({
    started: ["notifications", "notifications", "restaurants"], timezoneScope: [["id", "r1"]], status,
    body: status === 200 ? { notifications: [{ id: "notice" }], unread: 3, nextCursor: null, timeZone } : { error: "apiErr.generic" },
  });
});

it.each([["badges", badges], ["notifications", notifications]] as const)("keeps authorization before %s reads", async (_name, read) => {
  actor.mockResolvedValue(null);
  expect((await read(new NextRequest("http://localhost/api/read"))).status).toBe(403);
  expect(from).not.toHaveBeenCalled();
});

const markAll = (restaurantId?: string) => markNotifications(new NextRequest("https://test/api/notifications", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ all: true, ids: ["notice"], restaurantId }),
}));

it("refuses read markers from a bell belonging to a different restaurant", async () => {
  expect((await markAll("other-restaurant")).status).toBe(403);
  expect(from).not.toHaveBeenCalled();
});

it.each([{ name: "current", restaurantId: "r1" }, { name: "legacy", restaurantId: undefined }])("keeps $name marker requests scoped to the authorized restaurant", async ({ restaurantId }) => {
  queue([{ error: null }]);
  expect((await markAll(restaurantId)).status).toBe(200);
  const query = from.mock.results[0].value;
  expect(query.eq).toHaveBeenCalledWith("restaurant_id", "r1");
});

it("refuses marker writes without management authorization", async () => {
  actor.mockResolvedValue(null);
  expect((await markAll("r1")).status).toBe(403);
  expect(from).not.toHaveBeenCalled();
});
