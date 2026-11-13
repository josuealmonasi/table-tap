import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * React's `cache` memoises inside a server-component render only. A route
 * handler gets no memo, so every `currentUser()` is another round trip to the
 * auth server and every `getMembership()` another pair of reads. Pedidos
 * polls these routes, and each extra serial call lengthened the poll that
 * kept the page from ever going quiet.
 */
const RESTAURANT = "11111111-1111-4111-8111-111111111111";
const state = vi.hoisted(() => ({
  getUser: vi.fn(),
  tables: [] as string[],
  limited: false,
  pending: vi.fn(),
  collected: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: state.getUser } }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      state.tables.push(table);
      const owned = { id: RESTAURANT, currency: "MXN", timezone: "America/Mexico_City" };
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: table === "restaurants" ? owned : null, error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/rate-limit", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/rate-limit")>(),
  isRateLimited: async () => state.limited,
}));
vi.mock("@/lib/table-member-requests", () => ({ pendingPhones: state.pending }));
vi.mock("@/lib/collected-today", () => ({ collectedToday: state.collected }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
const { GET: membershipGET } = await import("@/app/api/table-membership/route");
const { GET: takingsGET } = await import("@/app/api/orders/takings/route");

const poll = () => membershipGET(new NextRequest(`https://test/api/table-membership?restaurantId=${RESTAURANT}`));

beforeEach(() => {
  state.getUser.mockReset().mockResolvedValue({ data: { user: { id: "owner", email: "owner@test" } }, error: null });
  state.tables = [];
  state.limited = false;
  state.pending.mockReset().mockResolvedValue([]);
  state.collected.mockReset().mockResolvedValue(10);
});

it("asks the auth server once and reads the membership once per floor poll", async () => {
  const response = await poll();
  expect(response.status).toBe(200);
  expect(state.getUser).toHaveBeenCalledTimes(1);
  expect(state.tables.sort()).toEqual(["restaurants", "staff"]);
  expect(state.pending).toHaveBeenCalledExactlyOnceWith(RESTAURANT);
});

it("asks the auth server once and reads the membership once per takings read", async () => {
  const response = await takingsGET();
  expect(response.status).toBe(200);
  expect(state.getUser).toHaveBeenCalledTimes(1);
  expect(state.tables.sort()).toEqual(["restaurants", "staff"]);
});

it("still refuses a limited caller before reading any phones", async () => {
  state.limited = true;
  expect((await poll()).status).toBe(429);
  expect(state.pending).not.toHaveBeenCalled();
});

it("still refuses a signed-out caller before reading any phones", async () => {
  state.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await poll()).status).toBe(403);
  expect(state.pending).not.toHaveBeenCalled();
});

it("answers a failed membership lookup with 503, and a limited one with 429 first", async () => {
  state.getUser.mockRejectedValue(new Error("auth down"));
  expect((await poll()).status).toBe(503);
  state.limited = true;
  expect((await poll()).status).toBe(429);
  expect(state.pending).not.toHaveBeenCalled();
});
