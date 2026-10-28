import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const r = "00000000-0000-0000-0000-000000000001";
const t = "00000000-0000-0000-0000-000000000002";
const session = "00000000-0000-0000-0000-000000000003";
const id = "00000000-0000-0000-0000-000000000004";
const s = vi.hoisted(() => ({ outcome: "started", staff: null as { restaurantId: string; email: string; role: string } | null,
  member: true, proposer: "m", calls: [] as { name: string; args: unknown }[], filters: [] as unknown[] }));
vi.mock("@/lib/api-guard", () => ({ actingStaff: async () => s.staff }));
vi.mock("@/lib/table-membership", () => ({ tableMember: async () => s.member ? { id: "m" } : null }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: { order_fee: 3 } }) }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false }));
vi.mock("@/lib/api-error", () => ({ apiError: async (key: string, status: number, _vars: unknown, extra: object) =>
  Response.json({ error: key, ...extra }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (name: string, args: unknown) => { s.calls.push({ name, args }); return { data: { outcome: s.outcome, revision: 2 }, error: null }; },
  from: (table: string) => {
    const q = { select: () => q, eq: (key: string, value: unknown) => { s.filters.push([table, key, value]); return q; },
      maybeSingle: async () => ({ data: { id, proposed_by: s.proposer }, error: null }) };
    return q;
  },
}) }));
const start = (await import("@/app/api/split/start/route")).POST;
const resize = (await import("@/app/api/split/resize/route")).POST;
const cancel = (await import("@/app/api/split/cancel/route")).POST;
const body = { restaurantId: r, tableId: t, sessionId: session, shares: 4, expectedCents: 11000,
  currency: "MXN", ref: id, splitId: id, revision: 1 };
const req = (data = body) => new NextRequest("http://localhost/api/split/start", { method: "POST", body: JSON.stringify(data) });
beforeEach(() => { s.outcome = "started"; s.staff = null; s.member = true; s.proposer = "m"; s.calls = []; s.filters = []; });
it("one approved phone starts four slots with the server's flat plan fee", async () => {
  expect((await start(req())).status).toBe(200);
  expect(s.calls).toEqual([{ name: "start_bill_split_v2", args: { p_restaurant: r, p_table: t, p_session: session,
    p_member: "m", p_shares: 4, p_expected_cents: 11000, p_currency: "MXN", p_ref: id, p_flat_fee_cents: 300 } }]);
});
it("front of house starts a split without a diner cookie", async () => {
  s.staff = { restaurantId: r, email: "waiter", role: "waiter" }; s.member = false;
  expect((await start(req())).status).toBe(200);
  expect(s.calls[0].args).toMatchObject({ p_member: null });
});
it.each(["repeat", "conflict", "busy", "stale", "nothing", "currency", "gone", "forbidden", "invalid"])("start preserves the %s result", async outcome => {
  s.outcome = outcome;
  const response = await start(req());
  expect(response.status).toBe(outcome === "repeat" ? 200 : outcome === "forbidden" ? 403 : outcome === "invalid" ? 400 : 409);
  expect(await response.json()).toMatchObject({ outcome });
});
it.each([[resize, "resized"], [cancel, "cancelled"]] as const)("revision checked control succeeds (%s)", async (route, outcome) => {
  s.outcome = outcome;
  expect((await route(req())).status).toBe(200);
  expect(s.calls[0].args).toMatchObject({ p_restaurant: r, p_split: id, p_revision: 1, p_actor: "m" });
  expect(s.filters).toContainEqual(["table_sessions", "table_id", t]);
  expect(s.filters).toContainEqual(["bill_splits", "restaurant_id", r]);
});
it.each([resize, cancel])("only proposer or staff changes a split (%s)", async route => {
  s.proposer = "another-diner";
  expect((await route(req())).status).toBe(403);
  expect(s.calls).toEqual([]);
});
it.each([resize, cancel])("staff can change a diner's split before its first attempt (%s)", async route => {
  s.staff = { restaurantId: r, email: "waiter", role: "waiter" }; s.proposer = "another-diner"; s.outcome = route === resize ? "resized" : "cancelled";
  expect((await route(req())).status).toBe(200);
});
it.each(["stale", "frozen", "gone"])("resize and cancel preserve %s without a generic error", async outcome => {
  s.outcome = outcome;
  for (const route of [resize, cancel]) {
    const response = await route(req());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: outcome });
  }
});
it.each(["kitchen", "foreign", "anonymous"])("%s cannot invoke the slot writers", async actor => {
  s.member = false;
  s.staff = actor === "anonymous" ? null : { restaurantId: actor === "foreign" ? t : r, email: actor, role: actor === "kitchen" ? "kitchen" : "waiter" };
  for (const route of [start, resize, cancel]) expect((await route(req())).status).toBe(403);
  expect(s.calls).toEqual([]);
});
