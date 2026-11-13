import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const f = vi.hoisted(() => ({ role: "waiter" as string | null, enabled: true, member: true,
  result: { outcome: "attached", cardId: "card", progress: 5, goal: 8 }, paid: false, closed: false,
  missing: false, failed: false, rpc: vi.fn(), filters: vi.fn(), writes: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false }));
vi.mock("@/lib/membership", () => ({
  MANAGES: (r: string) => r === "owner" || r === "manager",
  getMembership: async () => f.role ? { role: f.role, restaurant: { id: "10000000-0000-4000-8000-000000000001" } } : null,
  getMembershipWithUser: async () => f.role ? { user: { email: "staff@test" },
    membership: { role: f.role, restaurant: { id: "10000000-0000-4000-8000-000000000001" } } } : null,
}));
vi.mock("@/lib/current-user", () => ({ currentUser: async () => ({ email: "staff@test" }) }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: {} }) }));
vi.mock("@/lib/loyalty/server", () => ({ loyaltyOn: async () => f.enabled, CARD_COLUMNS: "id, goal, steps, round_no",
  programOf: async () => ({ reward: "Coffee" }), cardState: async () => ({ progress: 5, ladder: [{ visits: 8, reward: "Coffee" }], done: [] }) }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "es" }));
vi.mock("@/lib/table-membership", () => ({ openSittingAt: async () => ids.sessionId,
  tableMember: async (_req: unknown, restaurantId: string, tableId: string, sessionId: string) =>
    f.member ? { restaurantId, tableId, sessionId: sessionId === ids.sessionId ? sessionId : "other", closed: f.closed } : null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (...args: unknown[]) => { f.rpc(...args); return { data: f.result, error: f.failed ? {} : null }; },
  from: (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "neq"]) q[m] = (...args: unknown[]) => { f.filters(table, m, ...args); return q; };
    q.update = (value: unknown) => { f.writes(table, value); return q; };
    q.maybeSingle = async () => ({ error: f.failed ? {} : null, data: f.missing ? null : table === "loyalty_cards"
      ? { id: "card", code: "K7QM3XW9K7P2", goal: 8, round_no: 0 }
      : { id: ids.orderId, loyalty_card_id: "card", paid: f.paid, closed_at: f.closed ? "closed" : null, status: "received" } });
    return q;
  },
}) }));
import { GET, POST } from "../route";
const ids = { restaurantId: "10000000-0000-4000-8000-000000000001", orderId: "20000000-0000-4000-8000-000000000001",
  sessionId: "30000000-0000-4000-8000-000000000001", tableId: "40000000-0000-4000-8000-000000000001" };
const code = "K7QM-3XW9-K7P2";
const post = (body: object = { code, orderId: ids.orderId }) => POST(new NextRequest("https://test/api/loyalty/attach", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => { Object.assign(f, { role: "waiter", enabled: true, member: true, paid: false, closed: false, missing: false, failed: false,
  result: { outcome: "attached", cardId: "card", progress: 5, goal: 8 } }); vi.clearAllMocks(); });
it.each(["cashier", "waiter", "manager", "owner"])("%s attaches within their own restaurant", async role => {
  f.role = role;
  const res = await post();
  expect(res.status).toBe(200);
  expect(f.rpc).toHaveBeenCalledWith("attach_loyalty_card_v2", expect.objectContaining({ p_restaurant: ids.restaurantId, p_staff: true,
    p_code: "K7QM3XW9K7P2", p_order: ids.orderId, p_session: null, p_actor: "staff@test" }));
  expect(await res.json()).toEqual({ outcome: "attached", card: { suffix: "K7P2", progress: 5, goal: 8 } });
});
it.each(["kitchen", null])("%s cannot attach arbitrary orders", async role => {
  f.role = role; expect((await post()).status).toBe(403); expect(f.rpc).not.toHaveBeenCalled();
});
it.each([["unknown", 404], ["off", 409], ["paid", 409], ["gone", 404], ["taken", 409]] as const)("translates RPC %s", async (outcome, status) => {
  f.result.outcome = outcome; const res = await post();
  expect(res.status).toBe(status); const data = await res.json();
  expect(data.error).not.toMatch(/^loyaltyAttach\./); expect(data.outcome).toBe(outcome);
});
it("denies an off program or tier before writing", async () => {
  f.enabled = false; expect((await post()).status).toBe(409); expect(f.rpc).not.toHaveBeenCalled();
});
it("scopes a table attachment to its open sitting", async () => {
  expect((await post({ tableId: ids.tableId, code })).status).toBe(200);
  expect(f.rpc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ p_session: ids.sessionId, p_order: null }));
});
it("a member attaches the device's bearer code only to their live sitting", async () => {
  f.role = null; const sitting = { restaurantId: ids.restaurantId, tableId: ids.tableId, sessionId: ids.sessionId };
  expect((await post({ ...sitting, code })).status).toBe(200);
  expect(f.rpc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ p_actor: "diner", p_session: ids.sessionId }));
});
// Review access1: a member could replace another diner's card and take the
// table's ticket emails and stamps. Replacing needs the current card's code.
it("a diner replaces a different card only with that card's code", async () => {
  f.role = null; const sitting = { restaurantId: ids.restaurantId, tableId: ids.tableId, sessionId: ids.sessionId };
  await post({ ...sitting, code, currentCode: "abcd-efgh-jkmn" });
  expect(f.rpc).toHaveBeenCalledWith("attach_loyalty_card_v2", expect.objectContaining({
    p_actor: "diner", p_staff: false, p_current_code: "ABCDEFGHJKMN" }));
  f.result.outcome = "taken";
  const res = await post({ ...sitting, code });
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ outcome: "taken" });
  expect(f.rpc).toHaveBeenLastCalledWith("attach_loyalty_card_v2", expect.objectContaining({ p_staff: false, p_current_code: null }));
});
it("the database refuses a diner's replacement without the current card's code, under the row lock", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync("supabase/schema.sql", "utf8");
  const body = sql.split("create or replace function public.attach_loyalty_card_v2(")[1].split("$$;")[0];
  expect(body).toContain("p_staff boolean, p_current_code text\n)");
  expect(body).toMatch(/select loyalty_card_id into v_current from table_sessions[\s\S]*for update/);
  expect(body).toContain("if not p_staff and v_current is not null and v_current <> v_card.id and not exists (");
  expect(body).toContain("c.code = upper(replace(btrim(coalesce(p_current_code, '')), '-', ''))");
  expect(body.indexOf("'outcome', 'taken'")).toBeLessThan(body.indexOf("update table_sessions set loyalty_card_id"));
  expect(sql).toContain("revoke all on function public.attach_loyalty_card_v2(uuid, text, uuid, uuid, text, boolean, text) from public, anon, authenticated;");
  expect(readFileSync("supabase/drop.sql", "utf8")).toContain("drop function if exists public.attach_loyalty_card_v2(uuid, text, uuid, uuid, text, boolean, text);");
});
it.each(["unapproved", "other sitting", "closed", "preview", "order"])("refuses a diner's %s", async problem => {
  f.role = null; const body = { restaurantId: ids.restaurantId, tableId: ids.tableId, sessionId: ids.sessionId };
  f.member = problem !== "unapproved"; f.closed = problem === "closed";
  const res = await post({ ...body, code, ...(problem === "other sitting" ? { sessionId: ids.tableId } : {}),
    ...(problem === "preview" ? { preview: true } : {}), ...(problem === "order" ? { orderId: ids.orderId } : {}) });
  expect(res.status).toBe(403); expect(f.rpc).not.toHaveBeenCalled();
});
it("rejects another restaurant even for staff", async () => {
  expect((await post({ code, orderId: ids.orderId, restaurantId: ids.tableId })).status).toBe(403);
});
it.each([{}, { code: "bad", orderId: ids.orderId }, { code, orderId: ids.orderId, sessionId: ids.sessionId }])("rejects malformed targets or codes %j", async body => {
  expect((await post(body)).status).toBeGreaterThanOrEqual(400); expect(f.rpc).not.toHaveBeenCalled();
});
it.each(["paid", "missing", "closed"])("does not edit %s targets", async state => {
  Object.assign(f, { [state]: true }); expect((await post()).status).toBe(state === "paid" ? 409 : 404); expect(f.rpc).not.toHaveBeenCalled();
});
it("removes atomically only while unpaid and within this restaurant", async () => {
  expect((await post({ orderId: ids.orderId, remove: true })).status).toBe(200);
  expect(f.writes).toHaveBeenCalledWith("orders", { loyalty_card_id: null });
  expect(f.filters).toHaveBeenCalledWith("orders", "eq", "paid", false);
  expect(f.filters).toHaveBeenCalledWith("orders", "eq", "restaurant_id", ids.restaurantId);
});
it("a diner can remove only the card whose code they hold", async () => {
  f.role = null; const body = { restaurantId: ids.restaurantId, tableId: ids.tableId, sessionId: ids.sessionId };
  expect((await post({ ...body, code, remove: true })).status).toBe(200);
  expect(f.filters).toHaveBeenCalledWith("table_sessions", "eq", "loyalty_card_id", "card");
});
it("does not claim success after a database failure", async () => { f.failed = true; expect((await post()).status).toBe(503); });
it("reads only masked card details and hides unavailable controls", async () => {
  const req = () => new NextRequest(`https://test/api/loyalty/attach?orderId=${ids.orderId}`);
  const data = await (await GET(req())).json(); expect(data.enabled).toBe(true); expect(data.card.suffix).toBe("K7P2");
  expect(JSON.stringify(data)).not.toContain("K7QM3XW9");
  f.enabled = false; expect(await (await GET(req())).json()).toEqual({ enabled: false, card: null });
});

it.each(["paid", "closed", "missing"])("does not offer attachment for a %s target", async state => {
  Object.assign(f, { [state]: true });
  const data = await (await GET(new NextRequest(`https://test/api/loyalty/attach?orderId=${ids.orderId}`))).json();
  expect(data).toEqual({ enabled: false, card: null });
});
it("does not mix a Caja preview with an existing order", async () => {
  expect((await post({ code, orderId: ids.orderId, preview: true })).status).toBe(403);
});
