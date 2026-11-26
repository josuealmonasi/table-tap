import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const limiter = vi.hoisted(() => {
  const counts = new Map<string, number>();
  return { counts, hit: async (bucket: string, limit: number) => {
    const n = (counts.get(bucket) ?? 0) + 1;
    counts.set(bucket, n);
    return n > limit;
  } };
});
const mock = vi.hoisted(() => ({ after: vi.fn(), reset: vi.fn(), isRateLimited: vi.fn() }));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: mock.after }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({ clientKey: () => "ip", isRateLimited: mock.isRateLimited }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ auth: { resetPasswordForEmail: mock.reset } }) }));

import { POST } from "@/app/api/password-reset/route";
import { inboxMailKey } from "@/lib/signup-mail-ceiling";

const ask = (email: unknown) => POST(new NextRequest("https://tabletap.shop/api/password-reset", {
  method: "POST", headers: { Origin: "https://another.example" }, body: JSON.stringify({ email }),
}));
const runAfter = async () => { for (const [task] of mock.after.mock.calls) await task(); };

beforeEach(() => {
  vi.clearAllMocks();
  limiter.counts.clear();
  mock.isRateLimited.mockImplementation((bucket: string, limit: number) =>
    bucket.startsWith("password-reset-") ? limiter.hit(bucket, limit) : Promise.resolve(false));
  mock.reset.mockResolvedValue({ error: null });
});

it("answers the same 200 whether Auth sends, refuses, rate-limits or throws", async () => {
  const outcomes = [
    { error: null },
    { error: { status: 429, code: "over_email_send_rate_limit" } },
    { error: { status: 400, code: "user_not_found" } },
  ];
  const bodies = [];
  for (const [i, outcome] of outcomes.entries()) {
    mock.reset.mockResolvedValueOnce(outcome);
    const res = await ask(`person${i}@example.com`);
    expect(res.status).toBe(200);
    bodies.push(await res.json());
  }
  mock.reset.mockRejectedValueOnce(new Error("down"));
  bodies.push(await (await ask("person9@example.com")).json());
  await runAfter();
  expect(new Set(bodies.map(b => JSON.stringify(b)))).toEqual(new Set(['{"ok":true}']));
  expect(mock.reset).toHaveBeenCalledTimes(4);
});

it("sends through Auth's own template from this site's origin, after the response", async () => {
  await ask(" Owner@Example.com ");
  expect(mock.reset).not.toHaveBeenCalled();
  await runAfter();
  expect(mock.reset).toHaveBeenCalledExactlyOnceWith("owner@example.com", {
    redirectTo: "https://tabletap.shop/auth/callback?next=/reset-password",
  });
});

it("caps mail per canonical inbox with the same answer, and limits each network address", async () => {
  await ask("owner+1@gmail.com");
  const again = await ask("o.wner+2@googlemail.com");
  expect(again.status).toBe(200);
  expect(await again.json()).toEqual({ ok: true });
  expect(mock.after).toHaveBeenCalledTimes(1);
  expect(limiter.counts.has(`password-reset-10m:${inboxMailKey("password-reset", "owner@gmail.com")}`)).toBe(true);

  mock.isRateLimited.mockResolvedValueOnce(true);
  expect((await ask("someone@example.com")).status).toBe(429);
  expect(mock.isRateLimited).toHaveBeenCalledWith("password-reset:ip", 5, 60);
});

it("refuses a malformed address without contacting Auth", async () => {
  expect((await ask("not-an-email")).status).toBe(400);
  expect(mock.after).not.toHaveBeenCalled();
});

it("is what the form calls, and the reset email keeps its token in the fragment", () => {
  const form = readFileSync("src/components/auth/ForgotPasswordForm.tsx", "utf8");
  expect(form).toContain('fetch("/api/password-reset"');
  expect(form).not.toContain("resetPasswordForEmail");
  const template = readFileSync("docs/auth-email-templates/reset-password.html", "utf8");
  expect(template).toContain("/auth/confirm?next=/reset-password#token_hash={{ .TokenHash }}");
});
