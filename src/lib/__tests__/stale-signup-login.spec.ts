import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// A direct call to Auth's public signup leaves an unconfirmed login. v1 of the
// pending-signup request counted it as an account, so the real owner could
// never sign up. The release function and the routes that call it must agree.

const schema = readFileSync("supabase/schema.sql", "utf8");
const drop = readFileSync("supabase/drop.sql", "utf8");
const fn = (name: string): string => {
  const start = schema.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return schema.slice(start, schema.indexOf("$$;", schema.indexOf("$$", start) + 2));
};

describe("release_stale_signup_login_v1", () => {
  const body = fn("release_stale_signup_login_v1");

  it("releases only a login nothing vouches for", () => {
    for (const guard of [
      "u.email_confirmed_at is null",
      "u.invited_at is null",
      "u.created_at < clock_timestamp() - interval '1 minute'",
      "not exists (select 1 from public.staff s where s.user_id = u.id)",
      "not exists (select 1 from public.restaurants r where r.owner_id = u.id)",
      "not exists (select 1 from public.platform_admins a where a.user_id = u.id)",
    ]) expect(body).toContain(guard);
  });

  it("locks the address and the row before deleting", () => {
    expect(body).toMatch(/pg_advisory_xact_lock\(hashtextextended\('signup-email:' \|\| p_email, 0\)\)/);
    expect(body).toMatch(/for v_id in select u\.id from auth\.users u where u\.email = p_email for update loop/);
    expect(body.indexOf("for update")).toBeLessThan(body.indexOf("delete from auth.users"));
  });

  it("is callable by the server alone and dropped by drop.sql", () => {
    expect(schema).toContain("revoke all on function public.release_stale_signup_login_v1(text) from public, anon, authenticated;");
    expect(schema).toContain("grant execute on function public.release_stale_signup_login_v1(text) to service_role;");
    expect(drop).toContain("drop function if exists public.release_stale_signup_login_v1(text);");
  });
});

describe("request_pending_signup_v2", () => {
  it("releases a stale login before deciding the address has an account, and keeps v1", () => {
    const v2 = fn("request_pending_signup_v2");
    expect(v2).toContain("if not public.release_stale_signup_login_v1(p_email) then return true; end if;");
    expect(v2).not.toContain("exists (select 1 from auth.users");
    expect(fn("request_pending_signup_v1")).toContain("exists (select 1 from auth.users where email = p_email)");
    expect(drop).toContain("drop function if exists public.request_pending_signup_v2(text, text, text, text, text, text);");
  });
});

const mock = vi.hoisted(() => ({ rpc: vi.fn(), create: vi.fn(), maybeSingle: vi.fn(), calls: [] as string[] }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({ clientKey: () => "ip", isRateLimited: async () => false }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => {
  const q = { select: () => q, eq: () => q, gt: () => q, maybeSingle: mock.maybeSingle };
  return { from: () => q, rpc: mock.rpc, auth: { admin: { createUser: mock.create } } };
} }));

import { POST as confirm } from "@/app/api/signup/confirm/route";

const confirmRequest = () => new NextRequest("https://tabletap.shop/api/signup/confirm", {
  method: "POST", body: JSON.stringify({ token: "a".repeat(64), password: "Restaurant password" }),
});

describe("/api/signup/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.calls.length = 0;
    mock.maybeSingle.mockResolvedValue({ data: { id: "pending", payload: { email: "owner@example.com", locale: "es" } }, error: null });
    mock.rpc.mockImplementation(async (name: string) => { mock.calls.push(name); return { data: true, error: null }; });
    mock.create.mockImplementation(async () => { mock.calls.push("createUser"); return { data: { user: { id: "u" } }, error: null }; });
  });

  it("releases a squatted login before Auth creates the owner's", async () => {
    expect((await confirm(confirmRequest())).status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("release_stale_signup_login_v1", { p_email: "owner@example.com" });
    expect(mock.calls).toEqual(["release_stale_signup_login_v1", "createUser"]);
  });

  it("does not create a login when the release cannot run", async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: "57014" } });
    expect((await confirm(confirmRequest())).status).toBe(503);
    expect(mock.create).not.toHaveBeenCalled();
  });

  it("still refuses an address something vouches for (a pending staff invite)", async () => {
    mock.rpc.mockResolvedValueOnce({ data: false, error: null });
    mock.create.mockResolvedValueOnce({ data: { user: null }, error: { code: "email_exists" } });
    expect((await confirm(confirmRequest())).status).toBe(410);
  });
});
