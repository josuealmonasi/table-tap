import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";

const { state } = vi.hoisted(() => ({ state: {
  role: "kitchen", status: "cancelled", written_off: false, restaurant_id: "r1", race: "", writes: 0,
  filters: [] as [string, unknown][],
} }));
vi.mock("@/lib/api-guard", () => ({ actingStaff: async () => ({ role: state.role, restaurantId: "r1", email: "staff" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/membership", () => ({ MOVES_ORDERS: (role: string) => !["waiter", "cashier"].includes(role) }));
function database() {
  return { from: () => {
    let updating = false;
    let target: string;
    const filters: [string, unknown][] = [];
    const answer = () => {
      if (updating && state.race) {
        if (state.race === "write-off") state.written_off = true;
        else state.status = state.race;
      }
      const row: Record<string, unknown> = { id: "o1", status: state.status, written_off: state.written_off, restaurant_id: state.restaurant_id };
      const matches = filters.every(([key, value]) => row[key] === value);
      if (updating) {
        state.filters = filters;
        if (matches) { state.status = target; state.writes++; }
        return { data: matches ? [{ id: "o1" }] : [], error: null };
      }
      return { data: matches ? { ...row } : null, error: null };
    };
    const q = {
      select: () => q,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      update: (values: { status: string }) => { updating = true; target = values.status; return q; },
      single: async () => answer(),
      maybeSingle: async () => answer(),
      then: (resolve: (a: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
    };
    return q;
  } };
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => database() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => database() }));
const { PATCH } = await import("../route");
const send = (status: string, from?: string) => PATCH(new NextRequest("http://localhost/api/orders", {
  method: "PATCH", body: JSON.stringify({ id: "o1", status, from }),
}));
beforeEach(() => Object.assign(state, { role: "kitchen", status: "cancelled", written_off: false, restaurant_id: "r1", race: "", writes: 0, filters: [] }));
describe("ordinary order status moves", () => {
  it.each(["kitchen", "waiter", "cashier"])("%s cannot revive or complete a cancelled refunded order", async role => {
    state.role = role;
    const response = await send(role === "kitchen" ? "received" : "completed");
    expect(response.status).toBe(409);
    expect(state.status).toBe("cancelled");
    expect(state.writes).toBe(0);
  });
  it("does not release an unpaid checkout to the kitchen", async () => {
    state.status = "pending_payment";
    expect((await send("received")).status).toBe(409);
    expect(state.writes).toBe(0);
  });
  it("does not move a written-off ticket", async () => {
    state.status = "ready"; state.written_off = true;
    expect((await send("preparing")).status).toBe(409);
    expect(state.writes).toBe(0);
  });
  it("cannot move another restaurant's order even if the read policy exposes it", async () => {
    state.status = "received"; state.restaurant_id = "r2";
    expect((await send("preparing")).status).toBe(403);
    expect(state.writes).toBe(0);
  });
  it.each(["cancelled", "write-off", "ready"])("refuses when %s wins between the read and write", async race => {
    state.status = "received"; state.race = race;
    expect((await send("preparing")).status).toBe(409);
    expect(state.writes).toBe(0);
  });
  it.each([["received", "preparing"], ["preparing", "ready"], ["ready", "completed"],
    ["preparing", "received"], ["ready", "preparing"], ["ready", "received"]])("keeps the kitchen's %s → %s", async (from, to) => {
    state.status = from;
    expect((await send(to, from)).status).toBe(200);
    expect(state.status).toBe(to);
    expect(state.filters).toEqual(expect.arrayContaining([["restaurant_id", "r1"], ["status", from], ["written_off", false]]));
  });
  it.each(["waiter", "cashier"])("%s may hand over ready food but cannot skip cooking", async role => {
    state.role = role; state.status = "received";
    expect((await send("completed")).status).toBe(409);
    state.status = "ready";
    expect((await send("completed", "ready")).status).toBe(200);
  });
  it("refuses a stale queued move without reporting it applied", async () => {
    state.status = "ready";
    expect((await send("preparing", "received")).status).toBe(409);
    expect(state.writes).toBe(0);
  });
  it("does not skip a stage or reopen a completed order", async () => {
    state.status = "received";
    expect((await send("ready")).status).toBe(409);
    state.status = "completed";
    expect((await send("received")).status).toBe(409);
  });
});
it("the database also keeps cancelled and written-off status terminal", () => {
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const fn = schema.split("create or replace function public.keep_order_terminal()")[1]?.split("end; $$;")[0];
  expect(fn).toContain("old.status = 'cancelled' or old.written_off");
  expect(fn).toContain("new.status is distinct from old.status");
});
