import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// A chainable stand-in for the coupons table: the scoped read answers `saved`,
// and an update answers the rows it touched.
const db = vi.hoisted(() => ({ saved: null as { id: string; code: string } | null, updated: [] as { id: string }[], updates: [] as unknown[] }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ restaurantId: "r1", email: "m@example.com" }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status = 400) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain = {
        select: () => chain, eq: () => chain,
        maybeSingle: async () => ({ data: db.saved, error: null }),
        update: (row: unknown) => {
          db.updates.push(row);
          const after = { eq: () => after, select: async () => ({ data: db.updated, error: null }) };
          return after;
        },
      };
      return chain;
    },
  }),
}));
const { PATCH } = await import("../route");
const send = (body: object) => PATCH(new NextRequest("http://test/api/coupons", { method: "PATCH", body: JSON.stringify(body) }));
const terms = { kind: "percent", value: 20, maxUses: null, minSubtotal: 0, staffOnly: false, startsAt: null, endsAt: null };
beforeEach(() => { db.saved = { id: "c1", code: "OLD-123" }; db.updated = [{ id: "c1" }]; db.updates = []; });

it("refuses an edit that changes the code, which the update never saves (cross-review 6)", async () => {
  // Answered 200 while the saved code stayed OLD-123: the printed code was not the stored one.
  const res = await send({ id: "c1", code: "NEW-567", ...terms });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "coupons.codeFixed" });
  expect(db.updates).toEqual([]);
});

it("accepts the saved code, however it is typed, and saves the terms", async () => {
  const res = await send({ id: "c1", code: "old123", ...terms });
  expect(res.status).toBe(200);
  expect(db.updates).toHaveLength(1);
});

it("a coupon that is not the caller's is not found, never an empty success", async () => {
  db.saved = null;
  expect((await send({ id: "c9", ...terms })).status).toBe(404);
  expect((await send({ id: "c9", active: false })).status).toBe(404);
  expect(db.updates).toEqual([]);
});

it("an update that touched no row is not reported as saved", async () => {
  db.updated = [];
  expect((await send({ id: "c1", ...terms })).status).toBe(404);
  expect((await send({ id: "c1", active: true })).status).toBe(404);
});
