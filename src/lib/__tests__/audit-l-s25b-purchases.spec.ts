import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ log: vi.fn(), rpcs: [] as string[], error: null as { code: string } | null, filters: [] as unknown[][] }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ restaurantId: "restaurant", email: "owner" }) }));
vi.mock("@/lib/costs/guard", async original => ({ ...await original<object>(), costsBlocks: async () => null }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: state.log }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (name: string) => { state.rpcs.push(name); return { data: "purchase", error: state.error }; },
  from: () => {
    const q = { select: () => q, eq: (...args: unknown[]) => { state.filters.push(args); return q; }, maybeSingle: async () => ({ data: { name: "Milk" } }) };
    return q;
  },
}) }));
const { POST } = await import("@/app/api/costs/purchases/route");
const body = { ingredientId: "00000000-0000-4000-8000-000000000001", packs: 1, total: 100 };
const send = (ref?: string) => POST(new NextRequest("https://test/api/costs/purchases", { method: "POST", body: JSON.stringify({ ...body, ref }) }));
beforeEach(() => { state.error = null; state.rpcs = []; state.filters = []; state.log.mockClear(); });
it("L4 ingredient names read with the service key belong to this restaurant", async () => {
  expect((await send()).status).toBe(200);
  expect(state.filters).toContainEqual(["restaurant_id", "restaurant"]);
});
it("L4 reference purchases log inside their transaction, never again from a replaying route", async () => {
  await send(body.ingredientId); await send(body.ingredientId);
  expect(state.log).not.toHaveBeenCalled();
  expect(state.rpcs).toEqual(["record_purchase_once_v2", "record_purchase_once_v2"]);
});
it("L4 a different request under an old reference has its own 409 key", async () => {
  state.error = { code: "PT409" };
  const response = await send(body.ingredientId);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "apiErr.retryConflict" });
});
