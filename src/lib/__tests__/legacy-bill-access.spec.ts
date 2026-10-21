import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ members: [] as { id: string }[], ids: [] as string[], session: null as unknown, error: false, forgotten: false, customOrders: null as { id: string; diner: null; session_id: string; paid: boolean }[] | null }));
vi.mock("@/lib/table-membership", () => ({ tableMember: async (_req: unknown, _r: string, _t: string, session?: string) => state.forgotten && session === "old" ? { id: "member", sessionId: "old", closed: true } : state.session }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const q = { select: () => q, eq: () => q, order: () => q,
    in: (key: string, ids: string[]) => { if (key === "id" && table === "orders") state.ids = ids; return q; },
    then: (resolve: (data: unknown) => unknown) => Promise.resolve({ data: table === "orders"
      ? state.customOrders ?? state.ids.map(id => ({ id, diner: "22222222-2222-2222-2222-222222222222", session_id: "old" })) : state.members,
      error: state.error ? { message: "offline" } : null }).then(resolve),
  }; return q;
} }) }));
const { ownBillAccess } = await import("@/lib/legacy-bill-access");
const req = new NextRequest("https://test");
const orderId = "11111111-1111-1111-1111-111111111111";
beforeEach(() => { state.members = []; state.ids = []; state.session = null; state.error = false; state.forgotten = false; state.customOrders = null; });
it("keeps only private legacy order links payable and grants no live membership", async () => {
  expect(await ownBillAccess(req, "r", "t", "old", [orderId])).toEqual({
    id: "", sessionId: "old", restaurantId: "r", tableId: "t", closed: true, legacyOrderIds: [orderId],
  });
});
it("never treats a credential-era order as legacy, even with its private id", async () => {
  state.members = [{ id: "22222222-2222-2222-2222-222222222222" }];
  expect(await ownBillAccess(req, "r", "t", "old", [orderId])).toBeNull();
});
it("a printed table id, a self-chosen diner id or a session id alone buys no bill", async () => {
  expect(await ownBillAccess(req, "r", "t", "old", ["phone"])).toBeNull();
  expect(await ownBillAccess(req, "r", "t", "old")).toBeNull();
});
it("does not call an unreadable order legacy", async () => {
  state.error = true;
  await expect(ownBillAccess(req, "r", "t", "old", [orderId])).rejects.toThrow();
});

it("finds a closed member's own sitting again from remembered orders after the binding was cleared", async () => {
  state.forgotten = true;
  expect(await ownBillAccess(req, "r", "t", null, [orderId])).toMatchObject({ id: "member", sessionId: "old", closed: true });
});

it("does not let an earlier paid meal hide a later legacy bill that is still owed", async () => {
  const owedId = "33333333-3333-3333-3333-333333333333";
  state.customOrders = [
    { id: orderId, diner: null, session_id: "paid-visit", paid: true },
    { id: owedId, diner: null, session_id: "owed-visit", paid: false },
  ];
  expect(await ownBillAccess(req, "r", "t", null, [orderId, owedId])).toMatchObject({
    sessionId: "owed-visit", legacyOrderIds: [owedId],
  });
});
