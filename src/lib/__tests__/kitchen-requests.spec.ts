import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const state = vi.hoisted(() => ({ signedIn: true, tenant: "r1", failed: false, status: "open", writes: 0 }));
const id = "10000000-0000-4000-8000-000000000001";
vi.mock("@/lib/api-guard", () => ({ actingStaff: async () => state.signedIn ? { role: "kitchen", restaurantId: "r1" } : null }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/plan-server", () => ({ getPlan: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: vi.fn(), isTableLimited: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  const filters: [string, unknown][] = [];
  const q = {
    update: (patch: object) => { expect(patch).toEqual({ status: "done" }); return q; },
    eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
    select: async (columns: string) => {
      expect(columns).toBe("id");
      const row: Record<string, unknown> = { id, restaurant_id: state.tenant };
      const matches = !state.failed && filters.every(([key, value]) => row[key] === value);
      if (matches) { state.writes++; state.status = "done"; }
      return { data: matches ? [{ id }] : [], error: state.failed ? { message: "unread" } : null };
    },
  };
  return q;
} }) }));
const { PATCH } = await import("@/app/api/service-requests/route");
const send = (body: object = { id }) => PATCH(new NextRequest("http://localhost/api/service-requests", {
  method: "PATCH", body: JSON.stringify(body),
}));
beforeEach(() => Object.assign(state, { signedIn: true, tenant: "r1", failed: false, status: "open", writes: 0 }));
it("answers a kitchen call without returning the table's bill credential", async () => {
  const res = await send({ id, restaurantId: "r2", table_id: "forged", status: "open" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(state.status).toBe("done");
});
it("refuses a call in another restaurant without changing it", async () => {
  state.tenant = "r2";
  expect((await send()).status).toBe(404);
  expect(state.writes).toBe(0);
});
it("does not call a failed write answered", async () => {
  state.failed = true;
  expect((await send()).status).toBe(500);
  expect(state.writes).toBe(0);
});
it("requires a membership and a valid request id", async () => {
  state.signedIn = false;
  expect((await send()).status).toBe(403);
  state.signedIn = true;
  expect((await send({ id: 123 })).status).toBe(400);
  expect(state.writes).toBe(0);
});
