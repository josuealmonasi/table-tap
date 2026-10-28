import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ role: "manager", failed: false, reads: [] as { tenant: string; status: string; from: number; to: number }[] }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ["owner", "manager"].includes(state.role) ? { restaurantId: "r" } : null }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/pos-offline", () => ({ ringOffline: vi.fn() }));
vi.mock("@/lib/offline-comparison", () => ({ compareOfflineSale: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  let tenant = "", status = "all";
  const q = {
    select: () => q, eq: (key: string, value: string) => { if (key === "restaurant_id") tenant = value; return q; }, order: () => q,
    is: () => { status = "pending"; return q; }, not: () => { status = "history"; return q; },
    range: async (from: number, to: number) => {
      state.reads.push({ tenant, status, from, to });
      const rows = [...Array.from({ length: 2 }, (_, n) => ({ pos_ref: `pending-${n}`, approved_at: null })),
        ...Array.from({ length: 43 }, (_, n) => ({ pos_ref: `approved-${n}`, approved_at: "2026-10-27" }))];
      return { data: rows.filter(r => status === "all" || (status === "pending" ? !r.approved_at : r.approved_at)).slice(from, to + 1), error: state.failed ? { message: "offline" } : null };
    },
  }; return q;
} }) }));
import { GET } from "@/app/api/pos/recover/route";
const get = (search = "") => GET(new NextRequest(`http://localhost/api/pos/recover${search}`));
beforeEach(() => { state.role = "manager"; state.failed = false; state.reads = []; });
it("defaults to all pending rows only and scopes every page to the manager's restaurant", async () => {
  const res = await get(); expect(res.status).toBe(200);
  expect((await res.json()).sales.map((r: { pos_ref: string }) => r.pos_ref)).toEqual(["pending-0", "pending-1"]);
  expect(state.reads.every(r => r.tenant === "r" && r.status === "pending")).toBe(true);
});
it("returns stable, bounded approved history pages with a next-page indicator", async () => {
  const first = await (await get("?view=history&page=0")).json();
  const next = await (await get("?view=history&page=1")).json();
  const last = await (await get("?view=history&page=2")).json();
  expect(first.sales).toHaveLength(20); expect(first.hasMore).toBe(true);
  expect(next.sales[0].pos_ref).toBe("approved-20"); expect(last.sales).toHaveLength(3); expect(last.hasMore).toBe(false);
  expect(state.reads.every(r => r.status === "history" && r.tenant === "r" && r.to - r.from === 20)).toBe(true);
});
it.each(["cashier", "waiter", "kitchen"])("refuses %s before reading saved money", async role => { state.role = role; expect((await get()).status).toBe(403); expect(state.reads).toEqual([]); });
it.each(["-1", "1.5", "wat", "99999999999999"])("refuses invalid history page %s", async page => { expect((await get(`?view=history&page=${page}`)).status).toBe(400); expect(state.reads).toEqual([]); });
it("reports failed reads instead of an empty successful queue", async () => { state.failed = true; expect((await get("?view=history")).status).toBe(503); expect((await get()).status).toBe(503); });
