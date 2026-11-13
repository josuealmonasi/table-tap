import { describe, expect, it, vi } from "vitest";
import { ensureDemoUser } from "../../../scripts/mock-logins.mjs";

function database(user: { id: string; password_matches: boolean } | null, namespace = "extensions") {
  return { query: vi.fn(async (sql: string, values?: unknown[]) => {
    void values;
    if (sql.includes("from pg_extension")) return { rows: [{ nspname: namespace }] };
    if (sql.includes("from auth.users")) return { rows: user ? [user] : [] };
    return { rows: [] };
  }) };
}
function client() {
  return { auth: { admin: {
    createUser: vi.fn(async () => ({ data: { user: { id: "new" } }, error: null })),
    updateUserById: vi.fn(async () => ({ error: null as { message: string } | null })),
  } } };
}

describe("restoring demo logins in place", () => {
  it.each(["public", "extensions"])("keeps a healthy identity and password with pgcrypto in %s", async namespace => {
    const pg = database({ id: "same", password_matches: true }, namespace), admin = client();
    await expect(ensureDemoUser(pg, admin, "demo@tabletap.dev", "Diego Owner", "demo123")).resolves.toBe("same");
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(pg.query.mock.calls.find(([sql]) => sql.includes(`"${namespace}".crypt($2, encrypted_password)`))?.[1])
      .toEqual(["demo@tabletap.dev", "demo123"]);
    expect(pg.query.mock.calls.find(([sql]) => sql.includes("insert into profiles"))?.[1])
      .toEqual(["same", "Diego Owner"]);
  });
  it("restores a changed password through GoTrue without recreating the user", async () => {
    const admin = client();
    await expect(ensureDemoUser(database({ id: "same", password_matches: false }), admin, "demo@tabletap.dev", "Diego", "custom-password"))
      .resolves.toBe("same");
    expect(admin.auth.admin.updateUserById).toHaveBeenCalledExactlyOnceWith("same", { password: "custom-password" });
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });
  it("creates only a missing login and confirms it without sending mail", async () => {
    const admin = client();
    await expect(ensureDemoUser(database(null), admin, "demo@tabletap.dev", "Diego", "custom-password")).resolves.toBe("new");
    expect(admin.auth.admin.createUser).toHaveBeenCalledExactlyOnceWith({ email: "demo@tabletap.dev", password: "custom-password", email_confirm: true });
  });
  it("resets metadata, confirmation, role and bans only when changed; leaves sessions and identities alone", async () => {
    const pg = database({ id: "same", password_matches: true });
    await ensureDemoUser(pg, client(), "demo@tabletap.dev", "Diego", "demo123");
    const reset = pg.query.mock.calls.find(([sql]) => sql.startsWith("update auth.users"))!;
    expect(reset[1]).toEqual(["same"]);
    expect(pg.query.mock.calls).toContainEqual(["delete from platform_admins where user_id = $1", ["same"]]);
    for (const fragment of ["raw_user_meta_data = '{}'::jsonb", '"providers":["email"]', "role = 'authenticated'", "banned_until = null",
      "email_confirmed_at = coalesce(email_confirmed_at, now())", "is distinct from"]) expect(reset[0]).toContain(fragment);
    expect(pg.query.mock.calls.map(([sql]) => sql).join("\n")).not.toMatch(/(?:delete|update).*auth\.(sessions|identities)/);
  });
  it("stops when password restoration fails", async () => {
    const pg = database({ id: "same", password_matches: false }), admin = client();
    admin.auth.admin.updateUserById.mockResolvedValue({ error: { message: "refused" } });
    await expect(ensureDemoUser(pg, admin, "demo@tabletap.dev", "Diego", "demo123")).rejects.toThrow("demo@tabletap.dev: refused");
    expect(pg.query.mock.calls.some(([sql]) => sql.startsWith("update auth.users"))).toBe(false);
  });
});
