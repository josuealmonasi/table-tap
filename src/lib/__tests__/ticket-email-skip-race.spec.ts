import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const s = vi.hoisted(() => ({ skip: false, paid: false, queued: false,
  aEntered: () => {}, waitEntered: Promise.resolve(), bEntered: () => {}, aPaid: () => {}, waitB: Promise.resolve(), waitA: Promise.resolve() }));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: () => {} }));
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => ({ restaurantId: "11111111-1111-4111-8111-111111111111", email: "cashier" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false }));
vi.mock("@/lib/split-slots-access", () => ({ readSlotSplit: async () => ({ id: "split", order_ids: ["order"] }) }));
vi.mock("@/lib/split-slots-activity", () => ({ logSlotReceipt: async () => ({}) }));
vi.mock("@/lib/table-session", () => ({ closeSessionsFor: async () => {} }));
vi.mock("@/lib/table-outstanding", () => ({ tableOutstanding: async () => ({ owed: 0, balances: [] }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  const filters: [string, unknown][] = [];
  let patch: { ticket_email_skip: boolean } | undefined;
  const q = { select: () => q, is: () => q, in: () => q,
    eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
    update: (v: typeof patch) => { patch = v; return q; },
    then: (done: (v: unknown) => unknown) => {
      const matches = filters.every(([k, v]) => k === "paid" ? s.paid === v : k === "ticket_email_skip" ? s.skip === v : true);
      if (matches && patch) s.skip = patch.ticket_email_skip;
      return Promise.resolve({ data: matches ? [{ id: "order" }] : [], error: null }).then(done);
    },
  }; return q;
} }) }));
vi.mock("@/lib/split-slots-rpc", () => ({
  splitResponse: async () => Response.json({ outcome: "paid" }, { status: 409 }),
  splitRpc: async (_name: string, args: Record<string, unknown>) => {
    if (args.p_ref === "A") {
      s.aEntered();
      await s.waitB;
      // SQL chooses the ticket flag under the same lock as the paid transition.
      if ("p_skip_ticket_email" in args) s.skip = args.p_skip_ticket_email === true;
      s.paid = true; s.queued = !s.skip; s.aPaid();
      return { outcome: "collected", payment: "receipt" };
    }
    s.bEntered(); await s.waitA;
    return { outcome: "paid" };
  },
}));
import { POST } from "@/app/api/split/collect/route";
const id = "11111111-1111-4111-8111-111111111111";
const post = (ref: string, skip: boolean) => POST(new NextRequest("https://test/api/split/collect", { method: "POST", body: JSON.stringify({
  restaurantId: id, tableId: id, sessionId: id, splitId: id, revision: 1, slots: [0], expectedCents: 10000,
  currency: "MXN", method: "cash", ref, skipTicketEmail: skip,
}) }));
beforeEach(() => {
  s.skip = false; s.paid = false; s.queued = false;
  s.waitEntered = new Promise<void>(resolve => { s.aEntered = resolve; });
  s.waitB = new Promise<void>(resolve => { s.bEntered = resolve; });
  s.waitA = new Promise<void>(resolve => { s.aPaid = resolve; });
});
it("N7: only the winning collector's choice controls the ticket", async () => {
  const a = post("A", true);
  await s.waitEntered;
  const b = post("B", false);
  expect((await a).status).toBe(200); expect((await b).status).toBe(409);
  expect(s.skip).toBe(true); expect(s.queued).toBe(false);
});
