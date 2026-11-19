import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  createUser: vi.fn(async () => ({ data: { user: { id: "new-owner" } }, error: null })),
  deleteUser: vi.fn(async () => ({ error: null })),
  updateUserById: vi.fn(async () => ({ error: null })),
  mfa: {
    listFactors: vi.fn(async () => ({ data: { factors: [{ id: "totp" }] }, error: null })),
    deleteFactor: vi.fn(async () => ({ error: null })),
  },
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { admin: auth } }) }));
const { seedMock, dropMock } = await import("../../../scripts/mock-data.mjs");

function database() {
  return { query: vi.fn(async (sql: string) => {
    if (sql.startsWith("insert into restaurants")) throw new Error("stop before restaurant seed");
    if (sql.includes("from restaurants where name")) return { rows: [{ id: "old-restaurant" }] };
    if (sql.includes("from pg_extension")) return { rows: [{ nspname: "extensions" }] };
    if (sql.includes("from auth.users")) return { rows: [{ id: "kept-owner", password_matches: true }] };
    return { rows: [] };
  }) };
}

describe("demo login lifetime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SUPABASE_SECRET_KEY", "mock-only");
    vi.stubEnv("DEMO_PASSWORD", "fixture-demo-password");
  });
  afterEach(() => vi.unstubAllEnvs());
  it("reseeds the restaurant without deleting any of the five demo logins", async () => {
    const pg = database();
    await expect(seedMock(pg)).rejects.toThrow("stop before restaurant seed");
    expect(auth.deleteUser).not.toHaveBeenCalled();
    expect(auth.createUser).not.toHaveBeenCalled();
    expect(pg.query.mock.calls.find(([sql]) => sql.startsWith("insert into restaurants")))
      .toBeDefined();
  });
  it("a production reseed replaces the owner before rebuilding the restaurant", async () => {
    const pg = database();
    await expect(seedMock(pg, { production: true })).rejects.toThrow("stop before restaurant seed");
    expect(auth.deleteUser).toHaveBeenCalledWith("kept-owner");
    expect(auth.createUser).toHaveBeenCalledOnce();
    expect(auth.deleteUser.mock.invocationCallOrder[0]).toBeLessThan(auth.createUser.mock.invocationCallOrder[0]);
    const sql = pg.query.mock.calls.map(([text]) => text as string);
    // The new owner is put on the profile before the restaurant is rebuilt.
    const restaurant = sql.findIndex(text => text.startsWith("insert into restaurants"));
    expect(sql.findIndex(text => text.startsWith("insert into profiles"))).toBeLessThan(restaurant);
  });
  it("audit #648: a development reseed keeps the demo sessions the gates sign in with", async () => {
    const pg = database();
    await expect(seedMock(pg)).rejects.toThrow("stop before restaurant seed");
    expect(auth.mfa.listFactors).not.toHaveBeenCalled();
    expect(pg.query.mock.calls.some(([text]) => (text as string).includes("auth.sessions"))).toBe(false);
  });
  it("audit #648: the historical-receipt setting is cleared even when the seed fails partway", async () => {
    const pg = database();
    await expect(seedMock(pg)).rejects.toThrow("stop before restaurant seed");
    const sql = pg.query.mock.calls.map(([text]) => text as string);
    expect(sql.indexOf("select set_config('tabletap.allocation_origin', 'fixture_history', false)")).toBeGreaterThan(-1);
    expect(sql.at(-1)).toBe("select set_config('tabletap.allocation_origin', '', false)");
  });
  it("audit #648: a missing secret key refuses before the setting is ever set", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const pg = database();
    await expect(seedMock(pg)).rejects.toThrow("SUPABASE_SECRET_KEY missing");
    expect(pg.query).not.toHaveBeenCalled();
  });
  it("still deletes the five logins when explicitly dropping the demo", async () => {
    await expect(dropMock(database())).resolves.toBe(1);
    expect(auth.deleteUser).toHaveBeenCalledTimes(5);
  });
});
