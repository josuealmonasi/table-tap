import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// A collection that THROWS is refused too: SQL rolls the "don't send" mark
// back, with no separate flag write from the route, and the drain is registered only for an authorized, valid request
// (Codex review of #622).
const s = vi.hoisted(() => ({ drains: 0, undone: 0, actor: true as boolean, throws: null as Error | null }));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: () => { s.drains++; } }));
vi.mock("@/lib/ticket-email", () => ({
  drainTicketEmails: async () => {},
  skipTicketEmails: async () => async () => { s.undone++; },
}));
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => s.actor ? { restaurantId: "r", email: "waiter" } : null }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/plan-guard", () => ({ planBlocks: async () => null }));
vi.mock("@/lib/table-outstanding", () => ({ tableOutstanding: async () => ({ owed: 100, orders: [], balances: [] }) }));
vi.mock("@/lib/settle-reviewed-table", () => ({ settleReviewedTable: async () => { throw s.throws; } }));
vi.mock("@/lib/reviewed-collection", () => ({ recordReviewed: async () => { throw s.throws; } }));
const { PaymentAttributionRequired } = await import("@/lib/payment-coverage");
const whole = await import("@/app/api/table-payment/route");
const part = await import("@/app/api/table-payment/part/route");
const req = (url: string, data: unknown) => new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(data) });
const wholeBody = { tableId: "t", settlement: "cash", expected: 100, currency: "MXN", ref: "c-1", skipTicketEmail: true };
const partBody = { tableId: "t", amount: 50, tip: 0, method: "cash", ref: "c-1", expected: 100, currency: "MXN", skipTicketEmail: true };
beforeEach(() => { s.drains = 0; s.undone = 0; s.actor = true; s.throws = new PaymentAttributionRequired("attribution"); });

it("a whole-table collection that throws never writes a separate mark", async () => {
  expect((await whole.POST(req("/api/table-payment", wholeBody))).status).toBe(409);
  expect(s.undone).toBe(0);
});
it("a part collection that throws never writes a separate mark, attribution or not", async () => {
  expect((await part.POST(req("/api/table-payment/part", partBody))).status).toBe(409);
  s.throws = new Error("writer unavailable");
  await expect(part.POST(req("/api/table-payment/part", partBody))).rejects.toThrow("writer unavailable");
  expect(s.undone).toBe(0);
});
it("registers no drain for a refused caller or an invalid request", async () => {
  s.actor = false;
  expect((await whole.POST(req("/api/table-payment", wholeBody))).status).toBe(403);
  expect((await part.POST(req("/api/table-payment/part", partBody))).status).toBe(403);
  s.actor = true;
  expect((await whole.POST(req("/api/table-payment", { ...wholeBody, settlement: "cheque" }))).status).toBe(400);
  expect((await part.POST(req("/api/table-payment/part", { ...partBody, amount: -1 }))).status).toBe(400);
  expect(s.drains).toBe(0);
  expect(s.undone).toBe(0);
});
