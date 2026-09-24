import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";

/**
 * Who someone is, and what they may do, when the database or the auth server
 * does not answer.
 *
 * All three lookups read a failure as "nobody": the session as signed out,
 * the membership as a member of nothing, the admin row as not an admin. In a
 * blip an owner was told the account had no restaurant and to create a new
 * one, and a waiter collecting cash was told "forbidden". A missing row or a
 * missing session is still an answer; a failed read now throws. The plan is
 * the same: its null became "forbidden" for a restaurant on the right plan.
 */

vi.mock("react", async original => ({ ...(await original<typeof import("react")>()), cache: <T>(fn: T) => fn }));

const auth = { user: null as { id: string; email: string } | null, error: null as unknown };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: auth.user }, error: auth.error }) },
  }),
}));

/** What each table answers, as `{ data, error }`. */
const answers: Record<string, { data: unknown; error: { message: string } | null }> = {};
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => answers[table],
        single: async () => answers[table],
      };
      return query;
    },
  }),
}));

const { currentUser } = await import("@/lib/current-user");
const { getMembership } = await import("@/lib/membership");
const { getPlatformAdmin } = await import("@/lib/admin");
const { getPlan } = await import("@/lib/plan-server");

const OWNER = { id: "u1", email: "owner@example.com" };
const RESTAURANT = { id: "r1", name: "Casa" };
const none = { data: null, error: null };
const down = { data: null, error: { message: "canceling statement due to statement timeout" } };

beforeEach(() => {
  auth.user = OWNER;
  auth.error = null;
  answers.restaurants = none;
  answers.staff = none;
  answers.platform_admins = none;
});

describe("the session", () => {
  it("is signed out when there is no session", async () => {
    auth.user = null;
    auth.error = new AuthSessionMissingError();
    await expect(currentUser()).resolves.toBeNull();
  });

  it("throws when the auth server does not answer, rather than signing the user out", async () => {
    auth.user = null;
    auth.error = new AuthRetryableFetchError("fetch failed", 0);
    await expect(currentUser()).rejects.toThrow("fetch failed");
  });
});

describe("the membership", () => {
  it("is the owner's restaurant when the owner's row is there", async () => {
    answers.restaurants = { data: RESTAURANT, error: null };
    await expect(getMembership()).resolves.toEqual({ restaurant: RESTAURANT, role: "owner" });
  });

  it("is nothing when the account belongs to no restaurant", async () => {
    await expect(getMembership()).resolves.toBeNull();
  });

  it("throws when the owner's row cannot be read", async () => {
    answers.restaurants = down;
    await expect(getMembership()).rejects.toThrow("membership lookup failed");
  });

  it("throws when the staff row cannot be read, even with no owner's row", async () => {
    answers.staff = down;
    await expect(getMembership()).rejects.toThrow("membership lookup failed");
  });
});

describe("the platform admin", () => {
  it("is nobody when there is no admin row", async () => {
    await expect(getPlatformAdmin()).resolves.toBeNull();
  });

  it("is the admin when the row is there", async () => {
    answers.platform_admins = { data: { user_id: "u1", email: OWNER.email }, error: null };
    await expect(getPlatformAdmin()).resolves.toEqual({ userId: "u1", email: OWNER.email });
  });

  it("throws when the admin row cannot be read", async () => {
    answers.platform_admins = down;
    await expect(getPlatformAdmin()).rejects.toThrow("platform admin lookup failed");
  });
});

describe("the plan", () => {
  it("is nothing for a restaurant that does not exist", async () => {
    await expect(getPlan("00000000-0000-0000-0000-000000000000")).resolves.toBeNull();
  });

  it("is nothing for an id that is not one — diners' routes pass what the URL says", async () => {
    answers.restaurants = { data: null, error: { message: "invalid input syntax for type uuid", code: "22P02" } as { message: string } };
    await expect(getPlan("not-an-id")).resolves.toBeNull();
  });

  it("throws when the restaurant cannot be read, rather than refusing its own features", async () => {
    answers.restaurants = down;
    await expect(getPlan("r1")).rejects.toThrow("plan lookup failed");
  });
});
