import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
const mock = vi.hoisted(() => ({ user: { id: "owner", email_confirmed_at: "2026-11-09" } as { id: string; email_confirmed_at: string | null } | null,
  rpc: vi.fn(), resend: vi.fn(), limited: false }));
vi.mock("@/lib/current-user", () => ({ currentUser: async () => mock.user }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mock.rpc, auth: { resend: mock.resend } }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({ clientKey: () => "ip", isRateLimited: async () => mock.limited }));
import CompleteSignupPage from "@/app/signup/complete/page";
import { POST } from "@/app/api/signup/resend/route";
import { NextRequest } from "next/server";
beforeEach(() => {
  vi.stubGlobal("React", React); vi.clearAllMocks(); mock.limited = false;
  mock.user = { id: "owner", email_confirmed_at: "2026-11-09" };
  mock.rpc.mockResolvedValue({ data: "restaurant", error: null }); mock.resend.mockResolvedValue({ error: null });
});
it("E4: completion passes only the authenticated user to the private verification writer", async () => {
  await expect(CompleteSignupPage()).rejects.toThrow("redirect:/dashboard");
  expect(mock.rpc).toHaveBeenCalledWith("complete_owner_signup_v1", { p_user: "owner" });
});
it("E4: no session cannot activate a restaurant", async () => {
  mock.user = null;
  await expect(CompleteSignupPage()).rejects.toThrow("redirect:/login");
  expect(mock.rpc).not.toHaveBeenCalled();
});
it("E4: unverified pending signups return to verification", async () => {
  mock.user = { id: "owner", email_confirmed_at: null };
  mock.rpc.mockResolvedValue({ error: { code: "PT403" } });
  await expect(CompleteSignupPage()).rejects.toThrow("redirect:/signup/verify");
});
it("E4: an existing staff login without a pending signup still reaches its dashboard", async () => {
  mock.user = { id: "staff", email_confirmed_at: null };
  mock.rpc.mockResolvedValue({ data: null, error: null });
  await expect(CompleteSignupPage()).rejects.toThrow("redirect:/dashboard");
});
it("E4: a database outage keeps a retry on screen without using another trial", async () => {
  mock.rpc.mockResolvedValue({ error: { message: "offline" } });
  expect(renderToStaticMarkup(await CompleteSignupPage())).toContain("auth.signupFinishFailed");
});
it("E4: the trial starts once, under a pending restaurant lock, only after verified email ownership", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8").split("create or replace function public.complete_owner_signup_v1(")[1]?.split("$$;")[0] ?? "";
  expect(sql).toContain("owner_id = p_user and owner_signup_pending for update");
  expect(sql).toContain("email_confirmed_at");
  expect(sql).toContain("if v_confirmed is null");
  expect(sql).toContain("owner_signup_pending = false");
  expect(sql).toContain("clock_timestamp() + interval '30 days'");
  expect(sql).toContain("v_restaurant.terms_accepted_email");
  expect(readFileSync("supabase/schema.sql", "utf8").includes("revoke all on function public.complete_owner_signup_v1(uuid) from public, anon, authenticated")).toBe(true);
});
it("E4: resend is rate limited and has one conditional answer for unknown, verified and pending addresses", async () => {
  const request = () => new NextRequest("https://app.tabletap.mx/api/signup/resend", { method: "POST", body: JSON.stringify({ email: "owner@example.com" }) });
  for (const error of [null, { message: "already verified" }, { message: "unknown email" }]) {
    mock.resend.mockResolvedValue({ error });
    expect(await (await POST(request())).json()).toEqual({ ok: true });
  }
  mock.limited = true;
  expect((await POST(request())).status).toBe(429);
});
