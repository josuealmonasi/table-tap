import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Low fixes 2026-11-25 #3 and #4: a delivery's price becomes the ingredient's
 * price, so a total of 0 made it free; and derived values past the tables'
 * limits came back as a 500. Both are refused as what was typed.
 */
const state = vi.hoisted(() => ({ rpcs: [] as string[], error: null as { code: string } | null }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ restaurantId: "restaurant", email: "owner" }) }));
vi.mock("@/lib/costs/guard", async original => ({ ...await original<object>(), costsBlocks: async () => null }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (name: string) => { state.rpcs.push(name); return { data: "purchase", error: state.error }; },
  from: () => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { name: "Milk" }, error: null }) };
    return q;
  },
}) }));
const { POST } = await import("@/app/api/costs/purchases/route");
const ref = "00000000-0000-4000-8000-000000000002";
const send = async (over: object) => {
  const response = await POST(new NextRequest("https://test/api/costs/purchases", {
    method: "POST", body: JSON.stringify({ ingredientId: "00000000-0000-4000-8000-000000000001", packs: 1, total: 100, packSize: 1000, ...over }),
  }));
  return { status: response.status, error: (await response.json()).error as string | undefined };
};
beforeEach(() => { state.rpcs = []; state.error = null; });

it("refuses a delivery that cost nothing before it reaches the writer", async () => {
  expect(await send({ total: 0 })).toEqual({ status: 400, error: "apiErr.purchaseTotalZero" });
  expect(await send({ total: "0.00" })).toEqual({ status: 400, error: "apiErr.purchaseTotalZero" });
  expect(state.rpcs).toEqual([]);
});

it("refuses a price per pack or a quantity past the tables' limits", async () => {
  expect(await send({ packs: 0.5, total: 1_000_000 })).toEqual({ status: 400, error: "apiErr.purchaseTooLarge" });
  expect(await send({ packs: 10_000, packSize: 1001 })).toEqual({ status: 400, error: "apiErr.purchaseTooLarge" });
  expect(state.rpcs).toEqual([]);
  // At the limits exactly, it is recorded.
  expect((await send({ packs: 1, total: 1_000_000 })).status).toBe(200);
  expect((await send({ packs: 10_000, packSize: 1000, total: 1000 })).status).toBe(200);
});

it("answers a check constraint the route could not see as a 400, not a 500", async () => {
  state.error = { code: "23514" };
  expect(await send({ ref, packSize: undefined })).toEqual({ status: 400, error: "apiErr.purchaseTooLarge" });
  state.error = { code: "XX000" };
  expect((await send({})).status).toBe(500);
});

it("has both refusals in both languages", async () => {
  const [{ es }, { en }] = await Promise.all([import("@/lib/i18n/es"), import("@/lib/i18n/en")]);
  for (const key of ["purchaseTotalZero", "purchaseTooLarge"] as const) {
    expect(es.apiErr[key]).toBeTruthy();
    expect(en.apiErr[key]).toBeTruthy();
    expect(es.apiErr[key]).not.toBe(en.apiErr[key]);
  }
});
