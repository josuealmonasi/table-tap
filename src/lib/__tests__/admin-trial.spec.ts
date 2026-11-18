import { beforeEach, expect, it, vi } from "vitest";

const logged: { detail?: string | null }[] = [];
vi.mock("@/lib/activity-log", () => ({ logEvent: async (e: { detail?: string | null }) => void logged.push(e) }));
vi.mock("@/lib/public-menu-cache", () => ({ invalidatePublicMenu: () => {} }));
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
        if (hit) Object.assign(row, patch);
        resolve({ data: hit ? [{ id: row.id }] : [], error: null });
      },
    };
    return q;
  } } as never;
}
beforeEach(() => {
  logged.length = 0;
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
