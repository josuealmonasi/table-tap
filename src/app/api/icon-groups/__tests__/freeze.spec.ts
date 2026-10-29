import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const state = vi.hoisted(() => ({ actor: { restaurantId: "r", role: "owner", email: "owner@test" } as object | null,
  frozen: false, found: true, writes: vi.fn(), filters: [] as unknown[][] }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => state.actor }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => state.frozen ? NextResponse.json({}, { status: 402 }) : null }));
vi.mock("@/lib/api-error", () => ({ apiError: async (key: string, status: number) => NextResponse.json({ error: key }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  state.writes();
  const q = { delete: () => q, eq: (...args: unknown[]) => { state.filters.push(args); return q; },
    select: async () => ({ data: state.found ? [{ id: "g" }] : [], error: null }) };
  return q;
} }) }));
const { POST, PATCH, DELETE } = await import("@/app/api/icon-groups/route");
const request = () => new NextRequest("https://test/api/icon-groups", { method: "DELETE", body: JSON.stringify({ id: "g" }) });
beforeEach(() => {
  state.actor = { restaurantId: "r", role: "owner", email: "owner@test" };
  state.frozen = false;
  state.found = true;
  state.writes.mockClear();
  state.filters.length = 0;
});
describe("every icon-group mutation shares the desk freeze", () => {
  it.each([["POST", POST], ["PATCH", PATCH], ["DELETE", DELETE]] as const)("refuses frozen desk work before reaching the database: %s", async (_method, handler) => {
    state.frozen = true;
    expect((await handler(request())).status).toBe(402);
    expect(state.writes).not.toHaveBeenCalled();
  });
  it.each([["POST", POST], ["PATCH", PATCH], ["DELETE", DELETE]] as const)("requires a manager before desk work: %s", async (_method, handler) => {
    state.actor = null;
    expect((await handler(request())).status).toBe(403);
    expect(state.writes).not.toHaveBeenCalled();
  });
  it("still deletes an own group when the desk is open", async () => {
    expect((await DELETE(request())).status).toBe(200);
    expect(state.filters).toContainEqual(["restaurant_id", "r"]);
  });
  it("does not claim another restaurant's group was deleted", async () => {
    state.found = false;
    expect((await DELETE(request())).status).toBe(404);
    expect(state.filters).toContainEqual(["restaurant_id", "r"]);
  });
});
