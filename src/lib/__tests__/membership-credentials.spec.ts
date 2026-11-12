import { describe, it, expect, vi, beforeEach } from "vitest";

// The restaurant row as the database returns it, credential included.
const row = { id: "r1", name: "Demo Bistro", print_token: "secret-printer-token", currency: "MXN" };
let owned: unknown = null;
let staff: unknown = null;
let lookupError: { message: string } | null = null;
const reads: unknown[][] = [];
const currentUser = vi.fn<() => Promise<{ id: string; email?: string } | null>>();

vi.mock("@/lib/current-user", () => ({ currentUser: () => currentUser() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (key: string, value: unknown) => {
          reads.push([table, key, value]);
          return { maybeSingle: async () => ({ data: table === "restaurants" ? owned : staff, error: lookupError }) };
        },
      }),
    }),
  }),
}));

import { getMembership } from "@/lib/membership";
import { actingStaff, actingFrontOfHouse, actingManager, actingOwner } from "@/lib/api-guard";

beforeEach(() => {
  owned = null; staff = null; lookupError = null; reads.length = 0;
  currentUser.mockReset().mockResolvedValue({ id: "u1", email: "k@tabletap.dev" });
});

// Pages pass `membership.restaurant` to client components, whose props reach
// the browser whole: every role received the printer's credential that way.
describe("getMembership keeps the printer's credential on the server", () => {
  it("strips it for the owner", async () => {
    owned = { ...row };
    const m = await getMembership();
    expect(m?.restaurant.name).toBe("Demo Bistro");
    expect(JSON.stringify(m)).not.toContain("secret-printer-token");
  });

  it("strips it for a staff login", async () => {
    staff = { role: "kitchen", restaurant: { ...row } };
    const m = await getMembership();
    expect(m?.role).toBe("kitchen");
    expect(JSON.stringify(m)).not.toContain("secret-printer-token");
  });
});

it("reuses one verified user for every guard while keeping role, tenant, failure and credential checks", async () => {
  const guards = [actingStaff, actingFrontOfHouse, actingManager, actingOwner];
  const allowed = [
    ["owner", "manager", "waiter", "cashier", "kitchen"],
    ["owner", "manager", "waiter", "cashier"], ["owner", "manager"], ["owner"],
  ];
  const cases = ["owner", "manager", "waiter", "cashier", "kitchen", "unknown", "no-email", "owner-first", "signed-out", "unaffiliated", "lookup-error"];
  const results = [];
  for (const [index, guard] of guards.entries()) for (const scenario of cases) {
    owned = scenario === "owner-first" ? row : null;
    staff = scenario === "unaffiliated" ? null : { role: scenario === "no-email" ? "waiter" : scenario, restaurant: row };
    lookupError = scenario === "lookup-error" ? { message: "unavailable" } : null;
    currentUser.mockClear().mockResolvedValue(scenario === "signed-out" ? null : { id: "u1", ...(scenario === "no-email" ? {} : { email: "k@tabletap.dev" }) });
    reads.length = 0;
    let actor;
    try { actor = await guard(); } catch (error) { actor = (error as Error).message; }
    results.push({ index, scenario, actor, authReads: currentUser.mock.calls.length, scopes: [...reads] });
  }
  owned = row; staff = null; lookupError = null;
  currentUser.mockResolvedValue({ id: "u1", email: "k@tabletap.dev" });
  const publicMembership = await getMembership();
  expect({ publicMembership, results }).toEqual({
    publicMembership: { restaurant: { id: "r1", name: "Demo Bistro", currency: "MXN" }, role: "owner" },
    results: guards.flatMap((_, index) => cases.map(scenario => {
      const role = scenario === "unknown" ? "kitchen" : scenario === "no-email" ? "waiter" : scenario === "owner-first" ? "owner" : scenario;
      return { index, scenario, authReads: 1,
        scopes: scenario === "signed-out" ? [] : [["restaurants", "owner_id", "u1"], ["staff", "user_id", "u1"]],
        actor: scenario === "lookup-error" ? "membership lookup failed: unavailable" : allowed[index].includes(role)
          ? { restaurantId: "r1", role, email: scenario === "no-email" ? "staff" : "k@tabletap.dev" } : null,
      };
    })),
  });
});
