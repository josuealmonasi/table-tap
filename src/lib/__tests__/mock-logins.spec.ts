import { describe, expect, it, vi } from "vitest";
import { ensureDemoUser, revokeDemoAccess } from "../../../scripts/mock-logins.mjs";

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
    await expect(ensureDemoUser(pg, admin, "demo@tabletap.dev", "Diego Owner", "fixture-demo-password")).resolves.toBe("same");
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(pg.query.mock.calls.find(([sql]) => sql.includes(`"${namespace}".crypt($2, encrypted_password)`))?.[1])
      .toEqual(["demo@tabletap.dev", "fixture-demo-password"]);
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
    await ensureDemoUser(pg, client(), "demo@tabletap.dev", "Diego", "fixture-demo-password");
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
    await expect(ensureDemoUser(pg, admin, "demo@tabletap.dev", "Diego", "fixture-demo-password")).rejects.toThrow("demo@tabletap.dev: refused");
    expect(pg.query.mock.calls.some(([sql]) => sql.startsWith("update auth.users"))).toBe(false);
  });
});

describe("audit #648: revoking what a kept production demo login gained", () => {
  function mfa(factors: { id: string }[], error: { message: string } | null = null) {
    return { auth: { admin: { mfa: {
      listFactors: vi.fn(async () => ({ data: error ? null : { factors }, error })),
      deleteFactor: vi.fn(async () => ({ error: null as { message: string } | null })),
    } } } };
  }
  it("deletes every MFA factor through GoTrue, then sessions and tokens, then clears a pending email change, for that user only", async () => {
    const pg = database(null), admin = mfa([{ id: "totp" }, { id: "phone" }]);
    await revokeDemoAccess(pg, admin, "demo-user");
    expect(admin.auth.admin.mfa.deleteFactor.mock.calls).toEqual([[{ id: "totp", userId: "demo-user" }], [{ id: "phone", userId: "demo-user" }]]);
    expect(pg.query.mock.calls.map(([sql]) => sql.split("\n")[0])).toEqual([
      "delete from auth.refresh_tokens where user_id = $1::text",
      "delete from auth.sessions where user_id = $1",
      "update auth.users set email_change = '', email_change_token_new = '',",
    ]);
    for (const [, values] of pg.query.mock.calls) expect(values).toEqual(["demo-user"]);
    expect(pg.query.mock.calls[2][0]).toContain("email_change_confirm_status = 0");
  });
  it("stops before touching sessions when factors cannot be listed or deleted", async () => {
    const pg = database(null);
    await expect(revokeDemoAccess(pg, mfa([], { message: "admin down" }), "demo-user")).rejects.toThrow("admin down");
    const failing = mfa([{ id: "totp" }]);
    failing.auth.admin.mfa.deleteFactor.mockResolvedValue({ error: { message: "refused" } });
    await expect(revokeDemoAccess(pg, failing, "demo-user")).rejects.toThrow("refused");
    expect(pg.query).not.toHaveBeenCalled();
  });
});
