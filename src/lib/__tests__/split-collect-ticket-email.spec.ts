import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// "No enviar esta vez" on a divided bill's part: the route must mark exactly the
// orders the collection can settle (the split's frozen ones, unpaid, outside a
// customer account, in the actor's restaurant), inside the payment writer.
const s = vi.hoisted(() => ({
  steps: [] as string[], reads: [] as { filters: [string, string, unknown][] }[], writes: [] as { table: string; patch: unknown; filters: [string, string, unknown][] }[],
  split: { id: "split", order_ids: ["order-1", "order-2"] } as { id: string; order_ids: string[] } | null,
  drains: 0, outcome: "collected", actor: true, throws: false, skip: false, args: {} as Record<string, unknown>,
}));
const r = "00000000-0000-0000-0000-000000000001";
const t = "00000000-0000-0000-0000-000000000002";
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: () => { s.drains++; } }));
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => s.actor ? { restaurantId: r, email: "waiter" } : null }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false }));
vi.mock("@/lib/table-session", () => ({ closeSessionsFor: async () => {} }));
vi.mock("@/lib/table-outstanding", () => ({ tableOutstanding: async () => ({ owed: 0, balances: [] }) }));
vi.mock("@/lib/split-slots-activity", () => ({ logSlotReceipt: async () => "receipt" }));
vi.mock("@/lib/split-slots-access", () => ({ readSlotSplit: async () => s.split }));
vi.mock("@/lib/split-slots-rpc", () => ({
  splitRpc: async (_name: string, args: Record<string, unknown>) => {
    s.steps.push("collect"); s.args = args;
    if (s.throws) throw new Error("writer unavailable");
    if (s.outcome === "collected" && s.split?.order_ids.length) s.skip = args.p_skip_ticket_email === true;
    return { outcome: s.outcome, payment: "receipt" };
  },
  splitResponse: async (result: { outcome: string }) => Response.json(result, { status: 409 }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    // Any separate read or flag write is recorded: both belong in SQL now.
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
beforeEach(() => { s.steps = []; s.reads = []; s.writes = []; s.split = { id: "split", order_ids: ["order-1", "order-2"] }; s.drains = 0; s.outcome = "collected"; s.actor = true; s.throws = false; s.skip = false; s.args = {}; });

it("sends the choice and split to the locked writer without a separate order mark", async () => {
  expect((await POST(req({ ...body, skipTicketEmail: true }))).status).toBe(200);
  expect(s.steps).toEqual(["collect"]);
  expect(s.args).toMatchObject({ p_restaurant: r, p_split: "split", p_skip_ticket_email: true });
  expect(s.skip).toBe(true);
  // Never the whole table: an order placed after the split froze is not this bill.
  expect(s.reads).toEqual([]); expect(s.writes).toEqual([]);
});
it.each([[undefined], [false], ["yes"]])("a collection that sends (%s) clears an earlier part's mark: the latest choice wins (Codex review of #622)", async skip => {
  s.skip = true;
  expect((await POST(req({ ...body, skipTicketEmail: skip }))).status).toBe(200);
  expect(s.args.p_skip_ticket_email).toBe(false); expect(s.skip).toBe(false);
  expect(s.reads).toEqual([]); expect(s.writes).toEqual([]);
  expect(s.steps).toEqual(["collect"]);
});
it("a refused collection that sends keeps the earlier mark", async () => {
  s.outcome = "changed"; s.skip = true;
  expect((await POST(req({ ...body, skipTicketEmail: false }))).status).toBe(409);
  expect(s.skip).toBe(true); expect(s.writes).toEqual([]);
});
it("a collection that throws keeps no mark (Codex review of #622)", async () => {
  s.throws = true;
  expect((await POST(req({ ...body, skipTicketEmail: true }))).status).toBe(503);
  expect(s.skip).toBe(false); expect(s.writes).toEqual([]);
});
it("registers no drain for a caller who is refused or a request that is invalid (Codex review of #622)", async () => {
  s.actor = false;
  expect((await POST(req(body))).status).toBe(403);
  s.actor = true;
  expect((await POST(req({ ...body, method: "cheque" }))).status).toBe(400);
  expect(s.drains).toBe(0);
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
it("a refused collection keeps no mark (Codex review of #622)", async () => {
  s.outcome = "changed";
  expect((await POST(req({ ...body, skipTicketEmail: true }))).status).toBe(409);
  expect(s.skip).toBe(false); expect(s.writes).toEqual([]);
});
it("a duplicate collection cannot replace the successful collector's choice", async () => {
  s.outcome = "duplicate"; s.skip = true;
  expect((await POST(req({ ...body, skipTicketEmail: false }))).status).toBe(200);
  expect(s.skip).toBe(true); expect(s.writes).toEqual([]);
});
