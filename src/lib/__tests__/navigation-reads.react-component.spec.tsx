import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const from = vi.fn();
const actor = vi.fn();
vi.mock("@/lib/api-guard", () => ({ actingStaff: () => actor(), actingManager: () => actor() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
import { GET as badges } from "@/app/api/badges/route";
import { GET as notifications } from "@/app/api/notifications/route";

interface ReadResult {
  data?: unknown;
  count?: number | null;
  error: { message: string } | null;
}

function queue(results: ReadResult[]): void {
  // Supabase queries are awaitable even when the last operation is a filter.
  for (const result of results) from.mockReturnValueOnce(Object.assign(Promise.resolve(result), {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }));
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
});

it("keeps an explicit disabled setting empty without counting work", async () => {
  queue([{ data: { badges_enabled: false }, error: null }]);
  const response = await badges();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ badges: {} });
  expect(from).toHaveBeenCalledOnce();
});

it.each([0, 1])("refuses a failed notification read at step %s rather than emptying the bell", async index => {
  const reads: ReadResult[] = [{ data: [{ id: "notice" }], error: null }, { count: 3, error: null }];
  reads[index] = { data: null, count: null, error: { message: "database unavailable" } };
  queue(reads);
  const response = await notifications();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "apiErr.generic" });
});

it("keeps the notification list and its full unread count", async () => {
  queue([{ data: [{ id: "notice" }], error: null }, { count: 3, error: null }]);
  const response = await notifications();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ notifications: [{ id: "notice" }], unread: 3 });
});

it.each([["badges", badges], ["notifications", notifications]] as const)("keeps authorization before %s reads", async (_name, read) => {
  actor.mockResolvedValue(null);
  expect((await read()).status).toBe(403);
  expect(from).not.toHaveBeenCalled();
});
