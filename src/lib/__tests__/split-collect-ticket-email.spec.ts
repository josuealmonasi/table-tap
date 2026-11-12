import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// "No enviar esta vez" on a divided bill's part: the route must mark exactly the
// orders the collection can settle (the split's frozen ones, unpaid, outside a
// customer account, in the actor's restaurant), before the writer runs.
const s = vi.hoisted(() => ({
  steps: [] as string[], reads: [] as { filters: [string, string, unknown][] }[], writes: [] as { table: string; patch: unknown; filters: [string, string, unknown][] }[],
  split: { id: "split", order_ids: ["order-1", "order-2"] } as { id: string; order_ids: string[] } | null,
  drains: 0, outcome: "collected",
}));
const r = "00000000-0000-0000-0000-000000000001";
const t = "00000000-0000-0000-0000-000000000002";
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: () => { s.drains++; } }));
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => ({ restaurantId: r, email: "waiter" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false }));
vi.mock("@/lib/table-session", () => ({ closeSessionsFor: async () => {} }));
vi.mock("@/lib/table-outstanding", () => ({ tableOutstanding: async () => ({ owed: 0, balances: [] }) }));
vi.mock("@/lib/split-slots-activity", () => ({ logSlotReceipt: async () => "receipt" }));
vi.mock("@/lib/split-slots-access", () => ({ readSlotSplit: async () => s.split }));
vi.mock("@/lib/split-slots-rpc", () => ({
  splitRpc: async () => { s.steps.push("collect"); return { outcome: s.outcome, payment: "receipt" }; },
  splitResponse: async (result: { outcome: string }) => Response.json(result, { status: 409 }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    // A read of the orders to mark, then the write that marks exactly those.
    const build = (kind: "select" | "update", patch?: unknown) => {
      const write = { table, patch: kind === "update" ? patch : { select: true }, filters: [] as [string, string, unknown][] };
      const q = {
        eq: (c: string, v: unknown) => { write.filters.push(["eq", c, v]); return q; },
        is: (c: string, v: unknown) => { write.filters.push(["is", c, v]); return q; },
        in: (c: string, v: unknown) => { write.filters.push(["in", c, v]); return q; },
        then: (done: (v: unknown) => void) => {
          if (kind === "update") { s.steps.push("skip"); s.writes.push(write); done({ error: null }); return; }
          s.reads.push(write);
          const ids = (write.filters.find(([, c]) => c === "id")?.[2] as string[] | undefined) ?? [];
          done({ data: ids.map(id => ({ id })), error: null });
        },
      };
      return q;
    };
    return { select: () => build("select"), update: (patch: unknown) => build("update", patch) };
  },
}) }));
const { POST } = await import("@/app/api/split/collect/route");
const body = { restaurantId: r, tableId: t, sessionId: t, splitId: t, revision: 1, slots: [0], expectedCents: 5500,
  currency: "MXN", tipCents: 0, method: "cash", ref: "collection-1" };
const req = (data: unknown) => new NextRequest("http://localhost/api/split/collect", { method: "POST", body: JSON.stringify(data) });
beforeEach(() => { s.steps = []; s.reads = []; s.writes = []; s.split = { id: "split", order_ids: ["order-1", "order-2"] }; s.drains = 0; s.outcome = "collected"; });

it("marks only the split's frozen, unpaid, non-account orders in the actor's restaurant, before collecting", async () => {
  expect((await POST(req({ ...body, skipTicketEmail: true }))).status).toBe(200);
  expect(s.steps).toEqual(["skip", "collect"]);
  expect(s.reads[0].filters).toEqual(expect.arrayContaining([
    ["eq", "restaurant_id", r], ["eq", "paid", false], ["is", "account_id", null], ["in", "id", ["order-1", "order-2"]],
  ]));
  expect(s.writes).toEqual([{ table: "orders", patch: { ticket_email_skip: true }, filters: [
    ["eq", "restaurant_id", r], ["in", "id", ["order-1", "order-2"]],
  ] }]);
  // Never the whole table: an order placed after the split froze is not this bill.
  expect(s.reads[0].filters.some(([, column]) => column === "table_id")).toBe(false);
});
it.each([[undefined], [false], ["yes"]])("marks nothing when skipTicketEmail is %s", async skip => {
  expect((await POST(req({ ...body, skipTicketEmail: skip }))).status).toBe(200);
  expect(s.writes).toEqual([]);
  expect(s.steps).toEqual(["collect"]);
});
it("a split with no orders left writes nothing rather than a broader update", async () => {
  s.split = { id: "split", order_ids: [] };
  expect((await POST(req({ ...body, skipTicketEmail: true }))).status).toBe(200);
  expect(s.writes).toEqual([]);
});
it("a split that is gone marks nothing", async () => {
  s.split = null;
  expect((await POST(req({ ...body, skipTicketEmail: true }))).status).toBe(409);
  expect(s.writes).toEqual([]);
});
it("drains the queued tickets after answering, as every other payment route does", async () => {
  await POST(req(body));
  expect(s.drains).toBe(1);
});
it("a refused collection takes the mark back off (Codex review of #622)", async () => {
  s.outcome = "changed";
  expect((await POST(req({ ...body, skipTicketEmail: true }))).status).toBe(409);
  expect(s.writes.map(w => w.patch)).toEqual([{ ticket_email_skip: true }, { ticket_email_skip: false }]);
});
