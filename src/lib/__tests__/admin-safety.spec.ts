import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const events: Record<string, unknown>[] = [];
const effects: string[] = [];
const rpc = vi.fn();
let blocker: string | null;
let auditFails = false;
let resultAuditFails = false;
let finalBlocker: string | null;
let planRefused = false;
let allowed = true;
let staffIds: string[] = [];
const admin = { userId: "11111111-1111-4111-8111-111111111111", email: "admin@test.dev" };
vi.mock("@/lib/admin", () => ({ getPlatformAdmin: async () => allowed ? admin : null }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/admin-plan", () => ({ moveRestaurantPlan: async () => planRefused
  ? { ok: false, error: "apiErr.billingBusy", status: 409 } : { ok: true, from: "carta", to: "caja" } }));
vi.mock("@/lib/user-log", () => ({ logUserChange: vi.fn() }));
vi.mock("@/lib/billing-delete", () => ({ endRestaurantBilling: async () => { effects.push("billing"); } }));
vi.mock("@/lib/billing-operation", () => ({
  withRestaurantBilling: async (_db: unknown, _id: string, action: (op: unknown) => unknown) =>
    action({ write: async (fn: () => unknown) => fn(), record: async () => {} }),
  billingFailure: async () => NextResponse.json({ error: "failed" }, { status: 502 }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: (...args: unknown[]) => rpc(...args),
  auth: { admin: {
    updateUserById: async () => { effects.push("password"); return { error: null }; },
    createUser: async () => ({ data: { user: { id: "22222222-2222-4222-8222-222222222222" } }, error: null }),
    deleteUser: async () => { effects.push("login-delete"); return { error: null }; },
  } },
  from: (table: string) => {
    const filters: Record<string, unknown> = {};
    let insert: Record<string, unknown> | undefined;
    let deleting = false;
    const q = {
      select: () => q, eq: (key: string, value: unknown) => { filters[key] = value; return q; },
      order: () => q, limit: () => q, lt: () => q,
      insert: (value: Record<string, unknown>) => { insert = value; return q; },
      update: () => q, upsert: () => q,
      delete: () => { deleting = true; return q; },
      single: async () => ({ data: null, error: null }),
      maybeSingle: async () => ({ data: table === "restaurants" && (!filters.owner_id || filters.owner_id === "44444444-4444-4444-8444-444444444444")
        ? { id: "33333333-3333-4333-8333-333333333333", plan: "carta", plan_status: "active", name: "Cafe" }
        : table === "platform_admins" && filters.user_id === "22222222-2222-4222-8222-222222222222"
          ? { email: "new@test.dev" } : null, error: null }),
      then: (resolve: (value: unknown) => unknown) => {
        if (insert && table === "platform_admin_audit") {
          if (auditFails || resultAuditFails && events.length > 0) return Promise.resolve({ error: { message: "unavailable" } }).then(resolve);
          events.push(insert);
        }
        if (deleting) effects.push(`delete:${table}`);
        return Promise.resolve({ data: table === "staff" ? staffIds.map(user_id => ({ user_id })) : null, error: null }).then(resolve);
      },
    };
    return q;
  },
}) }));
const restaurants = await import("@/app/api/admin/restaurants/route");
const users = await import("@/app/api/admin/users/route");
const request = (path: string, method: string, body: object) => new NextRequest(`https://test.dev/api/admin/${path}`, {
  method, body: JSON.stringify(body),
});
beforeEach(() => {
  events.length = 0; effects.length = 0; blocker = null; finalBlocker = null;
  auditFails = false; resultAuditFails = false; allowed = true; planRefused = false; staffIds = [];
  rpc.mockReset().mockImplementation(async (fn: string, args: { p_check_only?: boolean }) => {
    if (fn === "admin_delete_restaurant") {
      if (blocker) return { data: { outcome: blocker }, error: null };
      if (!args.p_check_only && finalBlocker) return { data: { outcome: finalBlocker }, error: null };
      if (!args.p_check_only) effects.push("restaurant-delete");
      return { data: { outcome: args.p_check_only ? "ready" : "deleted" }, error: null };
    }
    return { data: true, error: null };
  });
});
it.each(["refund", "refundDue", "provider"])("refuses deletion for %s before touching billing or logins and records it", async reason => {
  blocker = reason;
  const response = await restaurants.DELETE(request("restaurants", "DELETE", { id: "33333333-3333-4333-8333-333333333333" }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: `apiErr.restaurantDelete${reason[0].toUpperCase()}${reason.slice(1)}` });
  expect(effects).toEqual([]);
  expect(events).toContainEqual(expect.objectContaining({ action: "restaurant.delete", outcome: "refused", target_id: "33333333-3333-4333-8333-333333333333" }));
});
it("deletes only through the locked RPC, after billing ends and before login cleanup", async () => {
  expect((await restaurants.DELETE(request("restaurants", "DELETE", { id: "33333333-3333-4333-8333-333333333333" }))).status).toBe(200);
  expect(effects).toEqual(["billing", "restaurant-delete"]);
  expect(rpc).toHaveBeenCalledWith("admin_delete_restaurant", expect.objectContaining({ p_check_only: false }));
});
it("leaves staff logins intact and records uncertainty when the final accounting copy fails", async () => {
  staffIds = ["55555555-5555-4555-8555-555555555555"];
  rpc.mockImplementation(async (_fn: string, args: { p_check_only?: boolean }) =>
    args.p_check_only ? { data: { outcome: "ready" }, error: null }
      : { data: null, error: { message: "accounting copy failed" } });
  expect((await restaurants.DELETE(request("restaurants", "DELETE", { id: "33333333-3333-4333-8333-333333333333" }))).status).toBe(500);
  expect(effects).toEqual(["billing"]);
  expect(events.at(-1)).toMatchObject({ outcome: "uncertain" });
});
it("records founding-owner password resets without ever storing the password", async () => {
  const password = "never-put-this-in-audit";
  expect((await users.PATCH(request("users", "PATCH", { userId: "44444444-4444-4444-8444-444444444444", password }))).status).toBe(200);
  expect(effects).toContain("password");
  expect(events).toContainEqual(expect.objectContaining({ action: "login.update", outcome: "succeeded", target_id: "44444444-4444-4444-8444-444444444444" }));
  expect(JSON.stringify(events)).not.toContain(password);
  expect(events[0]).toMatchObject({ actor_id: admin.userId, after_facts: { password_reset: true } });
  expect(events[1]).toMatchObject({ before_facts: { role: "founding_owner" } });
});
it("makes no sensitive change when the initial audit cannot be saved", async () => {
  auditFails = true;
  expect((await users.PATCH(request("users", "PATCH", { userId: "44444444-4444-4444-8444-444444444444", password: "abcdefgh" }))).status).toBe(503);
  expect(effects).toEqual([]);
});
it("records platform admin creation and deletion, with the new identity", async () => {
  expect((await users.POST(request("users", "POST", { email: "new@test.dev", password: "abcdefgh", role: "admin" }))).status).toBe(200);
  expect(events).toContainEqual(expect.objectContaining({ action: "login.create", outcome: "succeeded", target_id: "22222222-2222-4222-8222-222222222222", after_facts: expect.objectContaining({ role: "admin" }) }));
  expect((await users.DELETE(request("users", "DELETE", { userId: "22222222-2222-4222-8222-222222222222" }))).status).toBe(200);
  expect(events).toContainEqual(expect.objectContaining({ action: "login.delete", outcome: "succeeded" }));
  expect(events.at(-1)).toMatchObject({ before_facts: { role: "admin", email: "new@test.dev" }, after_facts: { deleted: true } });
});
it("records successful and refused plan moves", async () => {
  expect((await restaurants.PATCH(request("restaurants", "PATCH", { id: "33333333-3333-4333-8333-333333333333", plan: "caja" }))).status).toBe(200);
  expect(events).toContainEqual(expect.objectContaining({ action: "restaurant.plan", outcome: "succeeded", before_facts: expect.objectContaining({ plan: "carta" }), after_facts: expect.objectContaining({ plan: "caja" }) }));
  planRefused = true;
  expect((await restaurants.PATCH(request("restaurants", "PATCH", { id: "33333333-3333-4333-8333-333333333333", plan: "caja" }))).status).toBe(409);
  expect(events.at(-1)).toMatchObject({ outcome: "refused", after_facts: { http_status: 409 } });
});
it("rechecks after billing and leaves logins intact when a new refund wins", async () => {
  finalBlocker = "refund";
  expect((await restaurants.DELETE(request("restaurants", "DELETE", { id: "33333333-3333-4333-8333-333333333333" }))).status).toBe(409);
  expect(effects).toEqual(["billing"]);
  expect(events.at(-1)).toMatchObject({ outcome: "refused" });
});
it("keeps a durable start and reports uncertainty if the result audit fails", async () => {
  resultAuditFails = true;
  expect((await users.PATCH(request("users", "PATCH", { userId: "44444444-4444-4444-8444-444444444444", password: "abcdefgh" }))).status).toBe(503);
  expect(effects).toEqual(["password"]);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ outcome: "started", after_facts: { password_reset: true } });
});
it("fails closed on a failed deletion check", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });
  expect((await restaurants.DELETE(request("restaurants", "DELETE", { id: "33333333-3333-4333-8333-333333333333" }))).status).toBe(500);
  expect(effects).toEqual([]);
  expect(events.at(-1)).toMatchObject({ outcome: "uncertain" });
});
it("never creates a privileged audit row for a non-admin", async () => {
  allowed = false;
  expect((await users.PATCH(request("users", "PATCH", { userId: "44444444-4444-4444-8444-444444444444", password: "abcdefgh" }))).status).toBe(403);
  expect(events).toEqual([]); expect(effects).toEqual([]);
});
