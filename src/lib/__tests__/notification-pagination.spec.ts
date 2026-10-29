import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const state = vi.hoisted(() => ({ results: [] as object[], queries: [] as ReturnType<typeof query>[] }));
function query() {
  const q = {
    maybeSingle: async () => ({ data: { timezone: "Asia/Tokyo" }, error: null }),
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(),
    then: (resolve: (v: unknown) => void) => Promise.resolve(state.results.shift() ?? { data: [], error: null }).then(resolve),
  };
  state.queries.push(q); return q;
}
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ restaurantId: "r1" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => query() }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
import { GET, POST } from "@/app/api/notifications/route";
const req = (cursor = "") => new NextRequest(`https://test/api/notifications${cursor ? `?before=${encodeURIComponent(cursor)}` : ""}`);
const notice = (n: number) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, created_at: "2026-10-29T12:00:00+00:00", read_at: null });
beforeEach(() => { state.results = []; state.queries = []; });
it("pages unread entries before newer read entries, including equal timestamps", async () => {
  state.results.push({ data: Array.from({ length: 51 }, (_, n) => notice(51 - n)), error: null }, { count: 65, error: null });
  const result = await (await GET(req())).json();
  expect(result.timeZone).toBe("Asia/Tokyo");
  expect(result.notifications).toHaveLength(50);
  expect(result.nextCursor).toBe(`u|${notice(2).created_at}|${notice(2).id}`);
  expect(state.queries[0].is).toHaveBeenCalledWith("read_at", null);
  expect(state.queries[0].eq).toHaveBeenCalledWith("restaurant_id", "r1");
  expect(state.queries[0].order).toHaveBeenCalledWith("id", { ascending: false });
});
it("uses a time and id cursor rather than shifting offsets", async () => {
  state.results.push({ data: Array.from({ length: 51 }, (_, n) => notice(51 - n)), error: null }, { count: 65, error: null });
  const n = notice(99);
  await GET(req(`u|${n.created_at}|${n.id}`));
  expect(state.queries[0].or).toHaveBeenCalledWith(`created_at.lt.${n.created_at},and(created_at.eq.${n.created_at},id.lt.${n.id})`);
});
it("marks only the displayed IDs, leaving unseen and newly arrived alerts unread", async () => {
  state.results.push({ error: null });
  expect((await POST(new NextRequest("https://test/api/notifications", {
    method: "POST", body: JSON.stringify({ all: true, ids: [notice(1).id, notice(2).id], restaurantId: "r1" }),
  }))).status).toBe(200);
  expect(state.queries[0].in).toHaveBeenCalledWith("id", [notice(1).id, notice(2).id]);
  expect(state.queries[0].eq).toHaveBeenCalledWith("restaurant_id", "r1");
});
it("rejects an unbounded mark-all request", async () => {
  expect((await POST(new NextRequest("https://test/api/notifications", {
    method: "POST", body: JSON.stringify({ all: true }),
  }))).status).toBe(400);
  expect(state.queries).toHaveLength(0);
});


it("finishes the unread page before continuing into read history", async () => {
  state.results.push({ data: [notice(99)], error: null }, { count: 1, error: null },
    { data: Array.from({ length: 50 }, (_, n) => ({ ...notice(50 - n), read_at: "2026-10-29T13:00:00Z" })), error: null });
  const result = await (await GET(req())).json();
  expect(result.notifications).toHaveLength(50);
  expect(result.notifications[0].id).toBe(notice(99).id);
  expect(result.nextCursor).toBe(`r|${notice(2).created_at}|${notice(2).id}`);
  expect(state.queries[2].not).toHaveBeenCalledWith("read_at", "is", null);
});
it("continues read history without replaying unread entries", async () => {
  state.results.push({ data: [{ ...notice(1), read_at: "2026-10-29T13:00:00Z" }], error: null }, { count: 1, error: null });
  const result = await (await GET(req(`r|${notice(2).created_at}|${notice(2).id}`))).json();
  expect(state.queries[0].not).toHaveBeenCalledWith("read_at", "is", null);
  expect(result.nextCursor).toBeNull();
});
it.each(["u|bad|bad", "u|2026-10-29T12:00:00Z|bad", "u|2026-10-29T12:00:00Z|00000000-0000-4000-8000-000000000001|extra"])("rejects an unsafe cursor %s", async cursor => {
  expect((await GET(req(cursor))).status).toBe(400);
  expect(state.queries).toHaveLength(0);
});
it("keeps an empty displayed page a no-op", async () => {
  expect((await POST(new NextRequest("https://test/api/notifications", {
    method: "POST", body: JSON.stringify({ all: true, ids: [] }),
  }))).status).toBe(200);
  expect(state.queries).toHaveLength(0);
});
it("does not publish a partial page when read history fails", async () => {
  state.results.push({ data: [notice(1)], error: null }, { count: 1, error: null },
    { data: null, error: { message: "history unavailable" } });
  expect((await GET(req())).status).toBe(503);
});
