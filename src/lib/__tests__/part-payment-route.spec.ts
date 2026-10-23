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
  sittingFor: async () => "s1",
  closeBill: (...args: unknown[]) => closeBill(...args),
  summary: () => ({}),
}));
vi.mock("@/lib/reviewed-collection", () => ({ recordReviewed: (...args: unknown[]) => record(...args) }));
import { POST } from "@/app/api/table-payment/part/route";

beforeEach(() => {
  vi.clearAllMocks();
  outstanding.mockResolvedValue({ orders: [], sittings: [], ordered: 200, owed: 200, collected: 0, tips: 0 });
});

it("tells the waiter to retry a failed batch before reading, closing or logging success", async () => {
  record.mockResolvedValue({ wrote: false, refused: false, covered: false, landed: 0 });
  const response = await POST(new NextRequest("http://localhost/api/table-payment/part", {
    method: "POST", body: JSON.stringify({ tableId: "t1", expected: 200, currency: "MXN", amount: 200, method: "cash", ref: "tap" }),
  }));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "apiErr.collectionFailed" });
  expect(outstanding).toHaveBeenCalledTimes(1);
  expect(closeBill).not.toHaveBeenCalled();
  expect(logEvent).not.toHaveBeenCalled();
});

it("returns a saved MX$200 receipt when a lost response is retried against lower debt", async () => {
  outstanding.mockResolvedValue({ orders: [], sittings: [{ id: "s2", owed: 100 }], ordered: 100, owed: 100, collected: 0, tips: 0 });
  record.mockResolvedValue({ wrote: false, refused: true, covered: false, landed: 200, tip: 0 });
  const response = await POST(new NextRequest("http://localhost/api/table-payment/part", {
    method: "POST", body: JSON.stringify({ tableId: "t1", expected: 200, currency: "MXN", amount: 200, method: "cash", ref: "tap" }),
  }));
  expect(response.status).toBe(200);
  expect(record.mock.calls[0][2]).toBe(200);
  expect(await response.json()).toMatchObject({ amount: 200, tip: 0, duplicate: true });
});

it("S21 refuses MX$10 with a MX$50 tip before any receipt is written", async () => {
  record.mockResolvedValue({ wrote: true, landed: 20 });
  const response = await POST(new NextRequest("http://localhost/api/table-payment/part", {
    method: "POST", body: JSON.stringify({ tableId: "t1", expected: 200, currency: "MXN", amount: 10, tip: 50, method: "cash", ref: "tip" }),
  }));
  expect(response.status).toBe(400);
  expect(record).not.toHaveBeenCalled();
});

it("S21 refuses a reviewed MX$100 balance now owing MX$50 before recording", async () => {
  outstanding.mockResolvedValue({ orders: [], sittings: [], ordered: 100, owed: 50, collected: 50, tips: 0, currency: "MXN" });
  record.mockResolvedValue({ wrote: false, changed: true, landed: 0, owed: 50 });
  const response = await POST(new NextRequest("http://localhost/api/table-payment/part", {
    method: "POST", body: JSON.stringify({ tableId: "t1", expected: 100, currency: "MXN", amount: 100, tip: 0, method: "cash", ref: "stale" }),
  }));
  expect(response.status).toBe(409);
  expect(logEvent).not.toHaveBeenCalled();
  expect(closeBill).not.toHaveBeenCalled();
  expect(record.mock.calls[0][1]).toEqual({ tableId: "t1", expected: 100, currency: "MXN" });
});

// A tab or cached till from before the reviewed balance shipped sends neither
// `expected` nor `currency`. Refused as invalid, the waiter was left holding
// the customer's cash with nothing to record it against.
it("L2: a tab from before the reviewed balance is asked to refresh, whatever the table owes", async () => {
  // Nothing proves what it showed: MX$100 typed could clear US$100 after the
  // restaurant switched currencies, or a balance that grew meanwhile.
  for (const balances of [
    [{ currency: "MXN", ordered: 200, collected: 0, tips: 0, owed: 200 }],
    [{ currency: "USD", ordered: 100, collected: 0, tips: 0, owed: 100 }],
    [{ currency: "MXN", ordered: 200, collected: 0, tips: 0, owed: 200 }, { currency: "USD", ordered: 100, collected: 0, tips: 0, owed: 100 }],
  ]) {
    outstanding.mockResolvedValue({ orders: [], sittings: [], ordered: 300, owed: 300, collected: 0, tips: 0, balances });
    const response = await POST(new NextRequest("http://localhost/api/table-payment/part", {
      method: "POST", body: JSON.stringify({ tableId: "t1", amount: 100, method: "cash", ref: "old-tab" }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "apiErr.refreshToCollect" });
  }
  expect(record).not.toHaveBeenCalled();
});
