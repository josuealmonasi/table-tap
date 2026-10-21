import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const record = vi.fn();
const outstanding = vi.fn();
const closeBill = vi.fn();
const logEvent = vi.fn();
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => ({ restaurantId: "r1", email: "waiter@example.com" }) }));
vi.mock("@/lib/plan-guard", () => ({ planBlocks: async () => null }));
vi.mock("@/lib/api-error", () => ({ apiError: async (key: string, status: number) => Response.json({ error: key }, { status }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: (...args: unknown[]) => logEvent(...args) }));
vi.mock("@/lib/table-outstanding", () => ({ tableOutstanding: (...args: unknown[]) => outstanding(...args) }));
vi.mock("@/lib/part-payment", () => ({
  record: (...args: unknown[]) => record(...args),
  sittingFor: async () => "s1",
  closeBill: (...args: unknown[]) => closeBill(...args),
  summary: () => ({}),
}));
import { POST } from "@/app/api/table-payment/part/route";

beforeEach(() => {
  vi.clearAllMocks();
  outstanding.mockResolvedValue({ orders: [], sittings: [], ordered: 200, owed: 200, collected: 0, tips: 0 });
});

it("tells the waiter to retry a failed batch before reading, closing or logging success", async () => {
  record.mockResolvedValue({ wrote: false, refused: false, covered: false, landed: 0 });
  const response = await POST(new NextRequest("http://localhost/api/table-payment/part", {
    method: "POST", body: JSON.stringify({ tableId: "t1", amount: 200, method: "cash", ref: "tap" }),
  }));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "apiErr.collectionFailed" });
  expect(outstanding).toHaveBeenCalledTimes(1);
  expect(closeBill).not.toHaveBeenCalled();
  expect(logEvent).not.toHaveBeenCalled();
});

it("keeps the original collection amount when a partial attempt reduced today's debt", async () => {
  outstanding.mockResolvedValue({ orders: [], sittings: [{ id: "s2", owed: 100 }], ordered: 100, owed: 100, collected: 0, tips: 0 });
  record.mockResolvedValue({ wrote: true, refused: false, covered: false, landed: 100 });
  const response = await POST(new NextRequest("http://localhost/api/table-payment/part", {
    method: "POST", body: JSON.stringify({ tableId: "t1", amount: 200, method: "cash", ref: "tap" }),
  }));
  expect(response.status).toBe(200);
  expect(record.mock.calls[0][3]).toEqual({ food: 100, tip: 0, amount: 100 });
  expect(record.mock.calls[0][6]).toBe(200);
});
