import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";

/** Codex review bl40, findings 2–6: table admission and waiter calls. */
const state = vi.hoisted(() => ({
  member: null as null | { id: string; sessionId: string },
  qrKey: null as string | null,
  limited: [] as unknown[],
  rpc: [] as unknown[],
}));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({
  isRoomLimited: async () => false,
  isTableLimited: async (_req: unknown, _name: string, table: unknown) => { state.limited.push(table); return false; },
}));
vi.mock("@/lib/table-membership", () => ({ tableMember: async () => state.member }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: { allows_dine_in: true, allows_waiter_service: true } }) }));
vi.mock("@/lib/plan", () => ({ can: () => true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: "t", qr_key: state.qrKey }, error: null }) };
    return q;
  },
  rpc: async (fn: string, args: unknown) => { state.rpc.push([fn, args]); return { data: { status: "created" }, error: null }; },
}) }));
const { POST } = await import("@/app/api/service-requests/route");
const { qrKeyMatches, canonicalUuid } = await import("@/lib/table-qr-key");
const { PENDING_PHONE_MINUTES } = await import("@/lib/table-member-requests");

const R = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";
const KEY = "0123456789abcdef0123456789abcdef";
const read = (p: string): string => readFileSync(p, "utf8");
const schema = read("supabase/schema.sql");
const fn = (name: string): string => {
  const from = schema.indexOf(`create or replace function public.${name}(`);
  return schema.slice(from, schema.indexOf("end; $$;", from));
};
const call = (body: object) => POST(new NextRequest("https://test/api/service-requests", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => { state.member = null; state.qrKey = null; state.limited = []; state.rpc = []; });

describe("finding 2: an abandoned waiting phone leaves the queue", () => {
  it("refreshes its own wait, purges phones unseen for the same minutes the list hides, then counts", () => {
    // v4 (2026-11-26) keeps v3's queue rules; the route calls the newest.
    const v3 = fn("request_table_member_v4");
    const refresh = v3.indexOf("update table_session_members set seen_at = now()");
    const purge = v3.indexOf(`coalesce(seen_at, created_at) < now() - interval '${PENDING_PHONE_MINUTES} minutes'`);
    const count = v3.indexOf(">= 5 then");
    expect(refresh).toBeGreaterThan(v3.indexOf("for update"));
    expect(purge).toBeGreaterThan(refresh);
    expect(count).toBeGreaterThan(purge);
    expect(read("src/lib/table-membership.ts")).toContain('rpc("request_table_member_v4"');
    expect(read("src/lib/table-member-requests.ts")).toContain('.gte("seen_at", new Date(Date.now() - PENDING_PHONE_MINUTES * 60000)');
  });
});

describe("finding 3: a stale QR cannot summon staff to a renamed table", () => {
  it("refuses a waiting phone's waiter call with an old key", async () => {
    state.qrKey = KEY;
    const res = await call({ restaurantId: R, tableId: T, kind: "waiter", qrKey: "f".repeat(32) });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "apiErr.tableQrStale" });
    expect(state.rpc).toEqual([]);
  });

  it("accepts the current key, a member without one, and a table printed before keys", async () => {
    state.qrKey = KEY;
    expect((await call({ restaurantId: R, tableId: T, kind: "waiter", qrKey: KEY })).status).toBe(200);
    state.member = { id: "m", sessionId: "s" };
    expect((await call({ restaurantId: R, tableId: T, kind: "waiter" })).status).toBe(200);
    state.member = null;
    state.qrKey = null;
    expect((await call({ restaurantId: R, tableId: T, kind: "waiter" })).status).toBe(200);
  });

  it("compares keys safely", () => {
    expect(qrKeyMatches(KEY, KEY)).toBe(true);
    expect(qrKeyMatches(KEY, KEY.toUpperCase())).toBe(false);
    expect(qrKeyMatches(KEY, undefined)).toBe(false);
    expect(qrKeyMatches("short", "f".repeat(32))).toBe(false);
    expect(qrKeyMatches(null, undefined)).toBe(true);
  });

  it("rotates the key on rename or move, prints it in the QR, and never hands the stored one to the menu", () => {
    const rotate = fn("rotate_table_qr_key");
    expect(rotate).toContain("new.label is distinct from old.label or new.restaurant_id is distinct from old.restaurant_id");
    expect(schema).toMatch(/create trigger restaurant_tables_rotate_qr_key before update on restaurant_tables/);
    expect(read("src/app/dashboard/tables/page.tsx")).toContain("?k=${table.qr_key}");
    const page = read("src/app/r/[restaurantId]/t/[tableId]/page.tsx");
    expect(page).toContain('.select("id, restaurant_id, label")');
    expect(page).not.toMatch(/restaurant_tables"\)\s*\.select\("\*"\)/);
  });
});

describe("finding 4: the duplicate check and the insert are one locked call", () => {
  it("locks the table, then looks for an open call, then inserts", () => {
    const raise = fn("raise_service_request_v1");
    const lock = raise.indexOf("for update");
    const look = raise.indexOf("select id into v_id from service_requests");
    const insert = raise.indexOf("insert into service_requests");
    expect(lock).toBeGreaterThan(-1);
    expect(look).toBeGreaterThan(lock);
    expect(insert).toBeGreaterThan(look);
    expect(read("src/app/api/service-requests/route.ts")).not.toContain('from("service_requests").insert');
  });
});

describe("finding 5: one table, one rate-limit counter", () => {
  it("counts an upper-case id as the same lower-case table", async () => {
    state.member = { id: "m", sessionId: "s" };
    await call({ restaurantId: R.toUpperCase(), tableId: T.toUpperCase(), kind: "bill" });
    expect(state.limited).toEqual([T]);
    expect(state.rpc).toEqual([["raise_service_request_v1", { p_restaurant: R, p_table: T, p_kind: "bill", p_session: "s" }]]);
  });

  it("refuses a malformed id before counting it", async () => {
    expect((await call({ restaurantId: R, tableId: `${T} `, kind: "bill" })).status).toBe(400);
    expect((await call({ restaurantId: R, tableId: { id: T }, kind: "bill" })).status).toBe(400);
    expect(state.limited).toEqual([]);
    expect(canonicalUuid(T.toUpperCase())).toBe(T);
  });
});

describe("finding 6: bill and payment calls belong to the live sitting", () => {
  it("refuses a phone without live membership, even naming its old sitting", async () => {
    const res = await call({ restaurantId: R, tableId: T, kind: "pay", sessionId: "33333333-3333-4333-8333-333333333333" });
    expect(res.status).toBe(403);
    expect(state.rpc).toEqual([]);
  });

  it("asks for live membership only, and the SQL re-checks the sitting under the lock", () => {
    const route = read("src/app/api/service-requests/route.ts");
    expect(route).not.toContain("ownBillAccess");
    expect(route).toContain("tableMember(req, restaurantId, tableId)");
    const raise = fn("raise_service_request_v1");
    expect(raise).toContain("closed_at is null and opened_at >= now() - interval '8 hours'");
    expect(read("src/lib/table-bill.ts")).toContain("export const OPEN_BILL_HOURS = 8;");
  });
});
