import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { isolateMember } from "../../../scripts/browser-fixtures.mjs";

function fixture() {
  const order: string[] = [];
  const cookies: { name: string; value: string; url: string }[] = [];
  const eq = vi.fn(async () => { order.push("member removed"); return { error: null as { message: string } | null }; });
  const admin = { from: vi.fn(() => ({ delete: () => ({ eq }) })) };
  const ctx = {
    addCookies: async (next: typeof cookies) => { cookies.push(...next); },
    cookies: async () => cookies,
    pages: () => [{ close: async () => { order.push("page stopped"); } }],
    close: async () => { order.push("context closed"); },
  };
  return { admin, ctx, cookies, order, eq };
}

describe("each diner flow is its own phone", () => {
  it("gives jobs different cookies and removes only their own membership after stopping the page", async () => {
    const a = fixture();
    const b = fixture();
    await isolateMember(a.ctx, a.admin, "http://localhost:3100", true, false);
    await isolateMember(b.ctx, b.admin, "http://localhost:3100", true, false);
    expect(a.cookies[0].value).not.toBe(b.cookies[0].value);
    expect(a.cookies[0].value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await a.ctx.close();
    await a.ctx.close();
    expect(a.order).toEqual(["page stopped", "member removed", "context closed"]);
    expect(a.eq).toHaveBeenCalledExactlyOnceWith("token_hash", createHash("sha256").update(a.cookies[0].value).digest("hex"));
    await b.ctx.close();
  });

  it("closes the context even when membership cleanup fails", async () => {
    const a = fixture();
    a.eq.mockResolvedValue({ error: { message: "cleanup refused" } });
    await isolateMember(a.ctx, a.admin, "http://localhost:3100", true, false);
    await expect(a.ctx.close()).rejects.toThrow("cleanup refused");
    expect(a.order).toEqual(["page stopped", "context closed"]);
  });

  it("never deletes membership on production", async () => {
    const a = fixture();
    await isolateMember(a.ctx, a.admin, "https://example.com", true, true);
    await a.ctx.close();
    expect(a.admin.from).not.toHaveBeenCalled();
    expect(a.order).toEqual(["page stopped", "context closed"]);
  });
});

describe("a login that cannot be made is a failure, not a skip (audit L, 9)", () => {
  it("fails the admin's visits when its password is missing, unless the run leaves the role out on purpose", async () => {
    const { crewCookies } = await import("../../../scripts/browser-fixtures.mjs");
    const crew = [{ role: "admin", email: "admin@example.com", passwordEnv: "TT_TEST_MISSING_PASSWORD" }];
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("TT_TEST_MISSING_PASSWORD", "");
    vi.stubEnv("GATE_SKIP_ROLES", "");
    const phase = async (_: string, work: () => Promise<unknown>) => work();
    const missing = (await crewCookies(crew, "http://localhost:3000", phase)).get("admin");
    expect(missing.skip).toBeUndefined();
    expect(String(missing.error)).toMatch(/TT_TEST_MISSING_PASSWORD is not set, so no admin screen can be checked/);
    vi.stubEnv("GATE_SKIP_ROLES", "kitchen, admin");
    const chosen = (await crewCookies(crew, "http://localhost:3000", phase)).get("admin");
    expect(chosen).toEqual({ skip: "TT_TEST_MISSING_PASSWORD is not set — skipped (GATE_SKIP_ROLES)" });
    vi.unstubAllEnvs();
  });
});
