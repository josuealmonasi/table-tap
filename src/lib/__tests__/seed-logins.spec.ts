import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  createUser: vi.fn(async () => ({ data: { user: { id: "new-owner" } }, error: null })),
  deleteUser: vi.fn(async () => ({ error: null })),
  updateUserById: vi.fn(async () => ({ error: null })),
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
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("SUPABASE_SECRET_KEY", "mock-only"); });
  it("reseeds the restaurant without deleting any of the five demo logins", async () => {
    const pg = database();
    await expect(seedMock(pg)).rejects.toThrow("stop before restaurant seed");
    expect(auth.deleteUser).not.toHaveBeenCalled();
    expect(auth.createUser).not.toHaveBeenCalled();
    expect(pg.query.mock.calls.find(([sql]) => sql.startsWith("insert into restaurants")))
      .toBeDefined();
  });
  it("still deletes the five logins when explicitly dropping the demo", async () => {
    await expect(dropMock(database())).resolves.toBe(1);
    expect(auth.deleteUser).toHaveBeenCalledTimes(5);
  });
});
