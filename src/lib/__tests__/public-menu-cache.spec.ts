import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const state = vi.hoisted(() => ({ calls: [] as string[], cache: new Map<string, { tags: string[]; data: Promise<unknown> }>(), planRead: false, readError: "", cap: Infinity, plan: { allows_loyalty: true, allows_menu_schedules: true, allows_promotions: true, allows_online_ordering: true } }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown, keys: string[], options: { tags: string[] }) => async (...args: unknown[]) => {
    const key = JSON.stringify([keys, args]);
    if (!state.cache.has(key)) state.cache.set(key, { tags: options.tags, data: Promise.resolve(fn(...args)).catch(error => { state.cache.delete(key); throw error; }) });
    return structuredClone(await state.cache.get(key)!.data);
  },
  revalidateTag: (tag: string) => { for (const [key, entry] of state.cache) if (entry.tags.includes(tag)) state.cache.delete(key); },
}));
const visitorClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: () => visitorClient() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
const anonymousClient = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({ createClient: (...args: unknown[]) => { anonymousClient(...args); return client; } }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => {
  if (!state.planRead) { state.calls.push("plan"); state.planRead = true; }
  return { limits: state.plan };
} }));
vi.mock("@/lib/mail", () => ({ mailConfigured: () => true }));
vi.mock("@/lib/loyalty/pass", () => ({ issueVisitPass: () => `pass-${Date.now()}` }));
const rows: Record<string, Record<string, unknown>[]> = {
  restaurants: [{ id: "r1", name: "Cafe", timezone: "UTC", owner_id: "secret", cover_enabled: false, service_enabled: true }],
  menus: [{ id: "open", active: true, schedule: null }, { id: "hidden", active: false, schedule: null }],
  categories: [{ id: "c1", menu_id: "open" }, { id: "c2", menu_id: "hidden" }],
  menu_items: [
    { id: "dish", menu_id: "open", available: true, price: 10 },
    { id: "sold", menu_id: "open", available: false },
    { id: "private", menu_id: "hidden", available: true },
  ],
  promotions: [{ id: "deal", active: true, kind: "bogo", name: "Two coffees", buy_qty: 2, pay_qty: 1, items: [{ item_id: "dish", qty: 1 }] }], dietary_tags: [{ id: "tag", key: "vegan", label: "Vegan", sort_order: 0 }],
  item_addons: [{ product_id: "dish", addon_id: "extra" }],
  loyalty_programs: [{ active: true, goal: 5, reward: "Coffee", steps: null }],
  restaurant_tables: [{ id: "table", restaurant_id: "r1" }], table_sessions: [{ id: "sitting", table_id: "table", closed_at: null }],
};
const client = {
  from(table: string) {
    let result = structuredClone(rows[table] ?? []);
    let columns = "*";
    let single = false;
    const query = {
      select(value: string) { columns = value; return query; },
      eq(key: string, value: unknown) { if (key !== "restaurant_id") result = result.filter(r => r[key] === value); return query; },
      in(key: string, values: unknown[]) { result = result.filter(r => values.includes(r[key])); return query; },
      is() { return query; }, gte() { return query; }, limit() { return query; },
      order() { return query; }, range(from: number, to: number) { result = result.slice(from, to + 1); return query; },
      single() { single = true; return query; }, maybeSingle() { single = true; return query; },
      then(resolve: (r: unknown) => void) {
        state.calls.push(table);
        if (state.readError === table) { resolve({ data: null, error: { message: "database unavailable" } }); return; }
        // Model the anon policies as well as projection; admin menus alone may see hidden rows.
        if (table === "menu_items") result = result.filter(r => r.available && rows.menus.some(m => m.id === r.menu_id && m.active));
        if (table === "categories") result = result.filter(r => r.menu_id === "open");
        if (columns !== "*") result = result.map(r => Object.fromEntries(columns.split(",").map(c => c.trim()).filter(c => c in r).map(c => [c, r[c]]).concat(columns.includes("items:promotion_items(") ? [["items", r.items]] : [])));
        resolve({ data: single ? result[0] ?? null : result.slice(0, state.cap), error: null });
      },
    };
    return query;
  },
  rpc() { state.calls.push("ratings"); return Promise.resolve({ data: [], error: null }); },
} as unknown as SupabaseClient;

import { loadCoverState, menuShowsLoyalty } from "@/lib/menu-shell";
import { publicMenuRows, publicMenuCacheEnabled, invalidatePublicMenu } from "@/lib/public-menu-cache";
import { getPlan } from "@/lib/plan-server";
import { openSittingAt } from "@/lib/table-membership";
import { loadOrderingData } from "@/lib/ordering-data";

describe("restaurant public menu cache", () => {
  beforeEach(() => { vi.stubEnv("PUBLIC_MENU_CACHE", "1"); state.calls = []; state.cache.clear(); state.planRead = false; state.readError = ""; state.plan.allows_promotions = true; visitorClient.mockReset().mockResolvedValue(client); anonymousClient.mockClear(); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon-key"); });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
  it("does not repeat restaurant reads for the next diner", async () => {
    const first = await loadOrderingData("r1");
    const cold = state.calls.length;
    expect(cold).toBeGreaterThan(5);
    await loadOrderingData("r1");
    expect(state.calls.length - cold).toBe(0);
    expect(first.items.map(i => i.id)).toEqual(["dish"]);
    expect(first.restaurant).not.toHaveProperty("owner_id");
  });
  it("matches the existing public result, with hidden and sold-out rows withheld", async () => {
    vi.useFakeTimers(); vi.setSystemTime(30_001);
    vi.stubEnv("PUBLIC_MENU_CACHE", "0");
    const legacy = await loadOrderingData("r1");
    vi.stubEnv("PUBLIC_MENU_CACHE", "1");
    const cached = await loadOrderingData("r1");
    expect(cached).toEqual(legacy);
    expect(anonymousClient).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }));
  });

  it("counts a complete table visit: 19 before, 18 cold, 3 warm (one add-on row plus its empty final page)", async () => {
    async function visit() {
      state.calls = []; state.planRead = false;
      await Promise.all([loadCoverState("r1"), menuShowsLoyalty("r1")]);
      await Promise.all([loadOrderingData("r1"), client.from("restaurant_tables").select("*").eq("id", "table").single(), getPlan("r1")]);
      await openSittingAt("r1", "table");
      return [...state.calls];
    }
    vi.stubEnv("PUBLIC_MENU_CACHE", "0");
    expect(await visit()).toHaveLength(19);
    vi.stubEnv("PUBLIC_MENU_CACHE", "1");
    expect(await visit()).toHaveLength(18);
    expect(await visit()).toEqual(["plan", "restaurant_tables", "table_sessions"]);
  });

  it("keeps restaurants separate and invalidates both parts only for the edited restaurant", async () => {
    await loadOrderingData("r1"); await loadOrderingData("r2");
    state.calls = [];
    invalidatePublicMenu("r1");
    await loadOrderingData("r2"); expect(state.calls).toEqual([]);
    await loadOrderingData("r1"); expect(state.calls.length).toBeGreaterThan(5);
  });

  it("never serves a raw entry across the 30 second boundary", async () => {
    vi.useFakeTimers(); vi.setSystemTime(30_001);
    await publicMenuRows("r1"); const cold = state.calls.length;
    vi.setSystemTime(59_999); await publicMenuRows("r1"); expect(state.calls).toHaveLength(cold);
    vi.setSystemTime(60_000); await publicMenuRows("r1"); expect(state.calls).toHaveLength(cold * 2);
  });

  it("recomputes opening time and visit pass from a warm raw menu", async () => {
    const previous = rows.menus[0].schedule;
    rows.menus[0].schedule = { enabled: true, rules: [{ days: [0,1,2,3,4,5,6], start: "13:00", end: "14:00" }] };
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-10T12:59:59Z"));
    // Hold just the cache bucket fixed to prove that raw rows, not a refresh,
    // open the menu at 13:00. openMenuIds uses new Date(), not Date.now().
    vi.spyOn(Date, "now").mockReturnValue(30_001);
    try {
      expect((await loadOrderingData("r1")).closedNow).toBe(true);
      const cold = state.calls.length;
      vi.setSystemTime(new Date("2026-11-10T13:00:00Z"));
      const open = await loadOrderingData("r1");
      expect(open.closedNow).toBe(false); expect(open.items.map(i => i.id)).toEqual(["dish"]);
      expect(state.calls).toHaveLength(cold);
    } finally { rows.menus[0].schedule = previous; vi.restoreAllMocks(); }
  });

  it("defaults off outside Vercel production, with an explicit test switch", () => {
    vi.stubEnv("PUBLIC_MENU_CACHE", ""); vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("VERCEL_ENV", "production");
    expect(publicMenuCacheEnabled()).toBe(false);
    vi.stubEnv("NODE_ENV", "production"); expect(publicMenuCacheEnabled()).toBe(true);
    vi.stubEnv("VERCEL_ENV", "preview"); expect(publicMenuCacheEnabled()).toBe(false);
    vi.stubEnv("PUBLIC_MENU_CACHE", "1"); expect(publicMenuCacheEnabled()).toBe(true);
    vi.stubEnv("PUBLIC_MENU_CACHE", "0"); expect(publicMenuCacheEnabled()).toBe(false);
  });

  it("does not cache direct reads when disabled, and keeps the authorized till on its live loader", async () => {
    vi.stubEnv("PUBLIC_MENU_CACHE", "0");
    await publicMenuRows("r1"); const first = state.calls.length;
    await publicMenuRows("r1"); expect(state.calls).toHaveLength(first * 2);
    vi.stubEnv("PUBLIC_MENU_CACHE", "1"); anonymousClient.mockClear();
    await loadOrderingData("r1", { includeSoldOut: true });
    expect(anonymousClient).not.toHaveBeenCalled();
  });

  it("never consults a visitor session for either cached shell or contents", async () => {
    visitorClient.mockRejectedValue(new Error("owner cookie must not enter this cache"));
    await Promise.all([loadCoverState("r1"), menuShowsLoyalty("r1"), loadOrderingData("r1")]);
    expect(visitorClient).not.toHaveBeenCalled();
  });

  it("throws on refresh failure instead of serving an old bucket, and permits a fresh retry", async () => {
    vi.useFakeTimers(); vi.setSystemTime(30_001); await loadOrderingData("r1");
    state.readError = "menu_items"; vi.setSystemTime(60_000);
    await expect(loadOrderingData("r1")).rejects.toThrow("database unavailable");
    state.readError = "";
    expect((await loadOrderingData("r1")).items.map(i => i.id)).toEqual(["dish"]);
  });

  it("applies a live plan downgrade to promotions already held in a warm raw cache", async () => {
    expect((await loadOrderingData("r1")).promos.map(p => p.id)).toEqual(["deal"]);
    const reads = state.calls.length;
    state.plan.allows_promotions = false;
    expect((await loadOrderingData("r1")).promos).toEqual([]);
    expect(state.calls).toHaveLength(reads);
  });

it.each(["0", "1"])("N5: carries the split setting through the public reader (cache %s)", async cache => {
  vi.stubEnv("PUBLIC_MENU_CACHE", cache);
  rows.restaurants[0].split_enabled = false;
  try { expect((await loadOrderingData("r1")).restaurant?.split_enabled).toBe(false); }
  finally { delete rows.restaurants[0].split_enabled; }
});
it("N11: reads serving dishes behind a capped page of scheduled-closed dishes", async () => {
  const original = structuredClone({ menus: rows.menus, menu_items: rows.menu_items });
  state.cap = 1000;
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-10T18:00:00Z"));
  rows.menus = [{ id: "breakfast", active: true, schedule: { enabled: true, rules: [{ days: [0,1,2,3,4,5,6], start: "08:00", end: "10:00" }] } },
    { id: "open", active: true, schedule: null }];
  rows.menu_items = [...Array.from({ length: 1000 }, (_, i) => ({ id: `breakfast-${i}`, menu_id: "breakfast", available: true })),
    { id: "dinner", menu_id: "open", available: true }];
  try { expect((await loadOrderingData("r1")).items.map(i => i.id)).toEqual(["dinner"]); }
  finally { Object.assign(rows, original); state.cap = Infinity; vi.useRealTimers(); }
});

});
