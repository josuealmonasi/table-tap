import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const retrieve = vi.fn();
const list = vi.fn();
const sessions = vi.fn();
const customers = vi.fn();
const cancel = vi.fn();
const expire = vi.fn();
const remove = vi.fn();
const deleteUser = vi.fn();
const rpc = vi.fn();
let restaurant: Record<string, unknown>;
let active = true;
let open = false;
let record: Record<string, unknown>;
let deletionFailure = false;
let restaurantGone = false;
vi.mock("@/lib/admin", () => ({ getPlatformAdmin: async () => ({ email: "admin@test.com" }) }));
vi.mock("@/lib/admin-plan", () => ({ moveRestaurantPlan: vi.fn() }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/stripe", () => ({ stripe: {
  customers: { list: (...a: unknown[]) => customers(...a) },
  subscriptions: { retrieve: (...a: unknown[]) => retrieve(...a), list: (...a: unknown[]) => list(...a), cancel: (...a: unknown[]) => cancel(...a) },
  checkout: { sessions: { list: (...a: unknown[]) => sessions(...a), expire: (...a: unknown[]) => expire(...a) } },
} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: (...a: unknown[]) => rpc(...a), auth: { admin: { deleteUser } },
  from: (table: string) => {
    let deleting = false;
    const q = {
      select: () => q, eq: () => q, insert: () => q, delete: () => { deleting = true; return q; },
      maybeSingle: async () => ({ data: table === "restaurant_billing_operations" ? { state: record } : restaurantGone ? null : restaurant, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        if (deleting) { remove(); if (!deletionFailure) restaurantGone = true; }
        return Promise.resolve({ data: table === "staff" ? (restaurantGone ? [] : [{ user_id: "u1" }]) : restaurant,
          error: deleting && deletionFailure ? { message: "database unavailable" } : null }).then(resolve);
      },
    }; return q;
  },
}) }));
const { DELETE } = await import("@/app/api/admin/restaurants/route");
const run = () => DELETE(new NextRequest("https://tabletap.test/api/admin/restaurants", {
  method: "DELETE", body: JSON.stringify({ id: "r1" }),
}));
beforeEach(() => {
  vi.resetAllMocks(); active = true; open = false; record = {}; deletionFailure = false; restaurantGone = false;
  restaurant = { stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" };
  rpc.mockImplementation(async (fn: string, args: { p_state: object; p_check_only?: boolean }) => {
    if (fn === "admin_delete_restaurant") {
      if (args.p_check_only) return { data: { outcome: restaurantGone ? "gone" : "ready" }, error: null };
      remove();
      if (deletionFailure) return { data: null, error: { message: "database unavailable" } };
      restaurantGone = true;
      return { data: { outcome: "deleted" }, error: null };
    }
    if (fn === "record_restaurant_billing") {
      const next = { ...record, ...args.p_state } as Record<string, unknown>;
      for (const key of ["customers", "sessions", "subscriptions"]) {
        next[key] = [...new Set([...(record[key] as string[] ?? []), ...(next[key] as string[] ?? [])])];
      }
      record = next;
    }
    return { data: true, error: null };
  });
  retrieve.mockImplementation(async () => ({ id: "sub_1", status: active ? "active" : "canceled" }));
  list.mockResolvedValue({ data: [], has_more: false });
  customers.mockResolvedValue({ data: [], has_more: false });
  sessions.mockImplementation(async () => ({ data: open ? [{ id: "cs_1", mode: "subscription" }] : [], has_more: false }));
  cancel.mockImplementation(async () => { active = false; return { id: "sub_1", status: "canceled" }; });
  expire.mockImplementation(async () => { open = false; });
  deleteUser.mockResolvedValue({ error: null });
});
it("cancels billing and confirms termination before deleting staff and the restaurant", async () => {
  expect((await run()).status).toBe(200);
  expect(cancel).toHaveBeenCalledWith("sub_1", {}, expect.anything());
  expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(deleteUser.mock.invocationCallOrder[0]);
  expect(record).toMatchObject({ deletion_requested: true, deleted: true, subscriptions: ["sub_1"] });
});
it("keeps staff and billing IDs when Stripe cancellation fails", async () => {
  cancel.mockRejectedValue(new Error("Stripe unavailable"));
  expect((await run()).status).toBe(502);
  expect(remove).not.toHaveBeenCalled(); expect(deleteUser).not.toHaveBeenCalled();
  expect(record).toMatchObject({ deletion_requested: true, subscriptions: ["sub_1"] });
});
it("expires an open checkout and cancels a subscription which completed during deletion", async () => {
  restaurant.stripe_subscription_id = null; open = true;
  expire.mockImplementation(async () => { open = false; restaurant.stripe_subscription_id = "sub_1"; });
  expect((await run()).status).toBe(200);
  expect(expire.mock.invocationCallOrder[0]).toBeLessThan(cancel.mock.invocationCallOrder[0]);
});
it("does not delete while Stripe cannot confirm current billing", async () => {
  retrieve.mockRejectedValue(new Error("Stripe unavailable"));
  expect((await run()).status).toBe(502); expect(remove).not.toHaveBeenCalled();
});
it("retries a failed restaurant deletion without charging or canceling again", async () => {
  deletionFailure = true;
  expect((await run()).status).toBe(500);
  expect(record).toMatchObject({ deletion_requested: true, subscriptions: ["sub_1"] });
  deletionFailure = false;
  expect((await run()).status).toBe(200); expect(cancel).toHaveBeenCalledTimes(1);
});
it("refuses deletion while a recent request owns the billing lock", async () => {
  rpc.mockImplementation(async (fn: string) => ({ data: fn === "admin_delete_restaurant" ? { outcome: "ready" } : false, error: null }));
  expect((await run()).status).toBe(409);
  expect(retrieve).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
});

it("confirms a completed deletion again using the retained Stripe IDs", async () => {
  expect((await run()).status).toBe(200);
  expect(restaurantGone).toBe(true);
  expect((await run()).status).toBe(200);
  expect(cancel).toHaveBeenCalledTimes(1); expect(deleteUser).toHaveBeenCalledTimes(1);
  expect(record.subscriptions).toEqual(["sub_1"]);
});
it("retries staff cleanup from the retained IDs after the restaurant has gone", async () => {
  deleteUser.mockResolvedValueOnce({ error: { message: "Auth unavailable" } });
  expect((await run()).status).toBe(502);
  expect(restaurantGone).toBe(true);
  expect(record.staff_ids).toEqual(["u1"]);
  expect((await run()).status).toBe(200);
  expect(deleteUser).toHaveBeenLastCalledWith("u1");
  expect(record).toMatchObject({ deleted: true, staff_ids: [] });
  expect(cancel).toHaveBeenCalledTimes(1);
});
