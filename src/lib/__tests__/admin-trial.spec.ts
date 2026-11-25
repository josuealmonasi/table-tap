import { beforeEach, expect, it, vi } from "vitest";

const logged: { detail?: string | null }[] = [];
vi.mock("@/lib/activity-log", () => ({ logEvent: async (e: { detail?: string | null }) => void logged.push(e) }));
vi.mock("@/lib/public-menu-cache", () => ({ invalidatePublicMenu: () => {} }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
// The billing lock and Stripe's open pages, as the admin sees them under it.
const order: string[] = [];
let sessions: { id: string; metadata: Record<string, string> }[] = [];
let live: { id: string }[] = [];
vi.mock("@/lib/billing-operation", () => ({
  BillingError: class extends Error { constructor(public key: string, public status = 409) { super(key); } },
  withRestaurantBilling: async (_db: unknown, _id: string, action: (op: unknown) => unknown) => {
    order.push("lock");
    try { return await action({ record: async () => {}, write: async (fn: () => unknown) => fn() }); } finally { order.push("unlock"); }
  },
}));
vi.mock("@/lib/billing-state", () => ({
  restaurantBilling: async () => ({ live, sessions, exists: true, snapshot: { customers: [], sessions: sessions.map(s => s.id), subscriptions: [] } }),
}));
const expire = vi.fn(async (id: string) => { order.push(`expire:${id}`); });
const client = { checkout: { sessions: { expire } } } as never;
import { changeTrial } from "@/lib/admin-trial";

let row: Record<string, unknown>;
const NOW = Date.parse("2026-11-18T12:00:00Z");
function fakeDb() {
  return { from() {
    const where: Record<string, unknown> = {}; let patch: Record<string, unknown> | null = null;
    const q = {
      select: () => q, eq: (k: string, v: unknown) => ((where[k] = v), q), update: (p: Record<string, unknown>) => ((patch = p), q),
      maybeSingle: async () => ({ data: { ...row }, error: null }),
      then: (resolve: (v: unknown) => void) => {
        const hit = patch && Object.entries(where).every(([k, v]) => k === "id" || row[k] === v);
        if (hit) { Object.assign(row, patch); order.push("write"); }
        resolve({ data: hit ? [{ id: row.id }] : [], error: null });
      },
    };
    return q;
  } } as never;
}
beforeEach(() => {
  logged.length = 0; order.length = 0; sessions = []; live = []; expire.mockClear();
  row = { id: "r1", plan: "servicio", plan_status: "trialing", trial_ends_at: "2026-11-20T00:00:00Z", stripe_subscription_id: null, subscription_sync_revision: 2 };
});

it("extends a trial to a date within 90 days", async () => {
  expect(await changeTrial(fakeDb(), "r1", "2026-12-18T12:00:00Z", "a@x.dev", NOW)).toEqual({ ok: true });
  expect(row).toMatchObject({ trial_ends_at: "2026-12-18T12:00:00.000Z", plan: "servicio", subscription_sync_revision: 3 });
});

it("ends it now exactly like an expired trial: Carta, active", async () => {
  expect(await changeTrial(fakeDb(), "r1", null, "a@x.dev", NOW)).toEqual({ ok: true });
  expect(row).toMatchObject({ plan: "carta", plan_status: "active", trial_ends_at: null });
  expect(logged[0].detail).toContain("trial=ended");
});

it("refuses past or far dates, a paying restaurant, and one not on a trial", async () => {
  expect(await changeTrial(fakeDb(), "r1", "2026-11-01T00:00:00Z", "a@x.dev", NOW)).toMatchObject({ error: "apiErr.trialDateInvalid" });
  expect(await changeTrial(fakeDb(), "r1", "2027-06-01T00:00:00Z", "a@x.dev", NOW)).toMatchObject({ error: "apiErr.trialDateInvalid" });
  row.stripe_subscription_id = "sub_1";
  expect(await changeTrial(fakeDb(), "r1", null, "a@x.dev", NOW)).toMatchObject({ error: "apiErr.planHasSubscription", status: 409 });
  row.stripe_subscription_id = null; row.plan_status = "active";
  expect(await changeTrial(fakeDb(), "r1", null, "a@x.dev", NOW)).toMatchObject({ error: "apiErr.notOnTrial", status: 409 });
});

const assignmentPage = { id: "cs_699", metadata: { restaurant_id: "r1", plan: "servicio", tier_assignment_id: "as1" } };
const ownPage = { id: "cs_own", metadata: { restaurant_id: "r1", plan: "casa" } };

it("ending an assignment closes its open Checkout under the billing lock, before the move (review bl26, finding 5)", async () => {
  row.tier_assignment_id = "as1"; sessions = [assignmentPage, ownPage];
  expect(await changeTrial(fakeDb(), "r1", null, "a@x.dev", NOW, client)).toEqual({ ok: true });
  expect(order).toEqual(["lock", "expire:cs_699", "write", "unlock"]);
  expect(row).toMatchObject({ plan: "carta", tier_assignment_id: null });
});

it("shortening closes the assignment's pages too; extending leaves them payable", async () => {
  sessions = [assignmentPage];
  expect(await changeTrial(fakeDb(), "r1", "2026-11-19T00:00:00Z", "a@x.dev", NOW, client)).toEqual({ ok: true });
  expect(expire).toHaveBeenCalledWith("cs_699");
  expire.mockClear();
  expect(await changeTrial(fakeDb(), "r1", "2026-12-01T00:00:00Z", "a@x.dev", NOW, client)).toEqual({ ok: true });
  expect(expire).not.toHaveBeenCalled();
});

it("a failed expiry changes nothing", async () => {
  sessions = [assignmentPage];
  expire.mockRejectedValueOnce(Object.assign(new Error("stripe down"), { statusCode: 500 }));
  expect(await changeTrial(fakeDb(), "r1", null, "a@x.dev", NOW, client)).toEqual({ ok: false, error: "apiErr.billingUnavailable", status: 502 });
  expect(row).toMatchObject({ plan: "servicio", plan_status: "trialing", subscription_sync_revision: 2 });
});

it("a checkout already paid but not yet synced refuses the change", async () => {
  live = [{ id: "sub_paid" }]; sessions = [assignmentPage];
  expect(await changeTrial(fakeDb(), "r1", null, "a@x.dev", NOW, client)).toEqual({ ok: false, error: "apiErr.planHasSubscription", status: 409 });
  expect(expire).not.toHaveBeenCalled();
  expect(row.plan).toBe("servicio");
});
