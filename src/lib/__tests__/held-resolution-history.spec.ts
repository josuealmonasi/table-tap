import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], reads: [] as object[], cap: 1000 }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ restaurantId: "r" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/pos-offline", () => ({ ringOffline: vi.fn() }));
vi.mock("@/lib/offline-comparison", () => ({ compareOfflineSale: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  let tenant = "", clock = "", columns = ""; const empty: string[] = [];
  const q = { select: (c: string) => { columns = c; return q; }, eq: (_k: string, v: string) => { tenant = v; return q; },
    is: (k: string) => { empty.push(k); return q; }, not: (k: string) => { clock = k; return q; }, order: () => q,
    range: (from: number, to: number) => {
      state.reads.push({ tenant, clock, columns, from, to });
      const rows = state.rows.filter(r => r.restaurant_id === tenant && (!clock || r[clock]) && empty.every(k => !r[k]))
        .sort((a, b) => String(b[clock]).localeCompare(String(a[clock])) || String(a.pos_ref).localeCompare(String(b.pos_ref)))
        .slice(from, Math.min(to + 1, from + state.cap))
        .map(r => columns.includes("resolution:") ? r : Object.fromEntries(Object.entries(r).filter(([k]) => k !== "resolution")));
      const result = { data: rows, error: null };
      return { returns: async () => result, then: (done: (value: typeof result) => void) => Promise.resolve(result).then(done) };
    },
  }; return q;
} }) }));
import { GET } from "@/app/api/pos/recover/route";
const get = (search = "") => GET(new NextRequest(`http://localhost/api/pos/recover${search}`));
const resolution = { disposition: "no_cash", resolved_by: "manager@test.dev", resolved_at: "2026-11-11T12:00:00Z", reason: "No money was taken", amount: 0, currency: "MXN" };
const row = (pos_ref: string, approved_at: string | null, resolved_at: string | null, restaurant_id = "r") => ({ pos_ref, approved_at, resolved_at, restaurant_id });
beforeEach(() => { state.rows = []; state.reads = []; state.cap = 1000; });
it("includes resolution audit alongside approvals in decision order", async () => {
  state.rows = [row("approved", "2026-11-10T12:00:00Z", null), { ...row("resolved", null, resolution.resolved_at), resolution: [resolution] },
    row("pending", null, null), { ...row("other", null, "2026-11-12T12:00:00Z", "other"), resolution }];
  const res = await get("?view=history");
  expect({ status: res.status, body: await res.json() }).toEqual({ status: 200, body: { restaurantId: "r", hasMore: false, sales: [
    { ...row("resolved", null, resolution.resolved_at), resolution }, { ...row("approved", "2026-11-10T12:00:00Z", null), resolution: null },
  ] } });
});
it("pending excludes both decision kinds", async () => {
  state.rows = [row("approved", "2026-11-10", null), row("resolved", null, resolution.resolved_at), row("pending", null, null)];
  expect((await (await get()).json()).sales).toEqual([row("pending", null, null)]);
});
it("merges before pagination even under a lower Data API cap", async () => {
  state.cap = 3;
  state.rows = Array.from({ length: 45 }, (_, n) => {
    const at = new Date(Date.UTC(2026, 10, 11, 12, 0, -n)).toISOString();
    return n % 2 ? { ...row(String(n), null, at), resolution: { ...resolution, resolved_at: at } } : row(String(n), at, null);
  });
  const first = await (await get("?view=history&page=0")).json();
  const next = await (await get("?view=history&page=1")).json();
  const last = await (await get("?view=history&page=2")).json();
  expect({ first: first.sales.map((r: { pos_ref: string }) => r.pos_ref), next: next.sales.map((r: { pos_ref: string }) => r.pos_ref),
    last: last.sales.map((r: { pos_ref: string }) => r.pos_ref), more: [first.hasMore, next.hasMore, last.hasMore] }).toEqual({
    first: Array.from({ length: 20 }, (_, n) => String(n)), next: Array.from({ length: 20 }, (_, n) => String(n + 20)),
    last: ["40", "41", "42", "43", "44"], more: [true, true, false],
  });
});
