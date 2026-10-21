import { describe, it, expect, vi, beforeEach } from "vitest";

// The restaurant row as the database returns it, credential included.
const row = { id: "r1", name: "Demo Bistro", print_token: "secret-printer-token", currency: "MXN" };
let owned: unknown = null;
let staff: unknown = null;

vi.mock("@/lib/current-user", () => ({ currentUser: async () => ({ id: "u1", email: "k@tabletap.dev" }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: table === "restaurants" ? owned : staff, error: null }),
        }),
      }),
    }),
  }),
}));

import { getMembership } from "@/lib/membership";

// Pages pass `membership.restaurant` to client components, whose props reach
// the browser whole: every role received the printer's credential that way.
describe("getMembership keeps the printer's credential on the server", () => {
  beforeEach(() => { owned = null; staff = null; });

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
