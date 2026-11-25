import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// rate_limit_hit, in memory: a fixed window per bucket, counted on every hit.
const limiter = vi.hoisted(() => {
  const buckets = new Map<string, { count: number; start: number }>();
  let now = 0;
  return {
    buckets,
    advance: (seconds: number) => { now += seconds * 1000; },
    reset: () => { buckets.clear(); now = 0; },
    hit: async (bucket: string, limit: number, windowSeconds: number) => {
      const row = buckets.get(bucket);
      const fresh = !row || row.start < now - windowSeconds * 1000;
      const next = fresh ? { count: 1, start: now } : { count: row.count + 1, start: row.start };
      buckets.set(bucket, next);
      return next.count > limit;
    },
  };
});
const mock = vi.hoisted(() => ({
  after: vi.fn(), rpc: vi.fn(), insert: vi.fn(), maybeSingle: vi.fn(), isRateLimited: vi.fn(),
}));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: mock.after }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({ clientKey: () => "ip", isRateLimited: mock.isRateLimited }));
vi.mock("@/lib/signup-confirmation", () => ({ sendSignupMail: vi.fn(), resendLegacySignupConfirmation: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => {
  const q = { select: () => q, eq: () => q, gt: () => q, order: () => q, limit: () => q,
    maybeSingle: mock.maybeSingle, insert: mock.insert };
  return { from: () => q, rpc: mock.rpc };
} }));

import { POST as signup } from "@/app/api/signup/route";
import { POST as resend } from "@/app/api/signup/resend/route";
import { SIGNUP_MAIL_COOLDOWN_SECONDS, SIGNUP_MAILS_PER_DAY, signupMailKey } from "@/lib/signup-mail-ceiling";

const pending = { payload: { email: "owner@example.com", restaurantName: "Cafe", locale: "en" }, expires_at: "2099-01-01T00:00:00Z" };
const request = (path: string, fields: object) => new NextRequest(`https://tabletap.shop/api/signup${path}`, {
  method: "POST", body: JSON.stringify(fields),
});
const askSignup = (email = "owner@example.com") =>
  signup(request("", { restaurantName: "Cafe", email, acceptedTerms: true }));
const askResend = (email = "owner@example.com") => resend(request("/resend", { email }));

beforeEach(() => {
  vi.clearAllMocks();
  limiter.reset();
  // The per-network-address limits stay out of the way: every request below
  // could come from a different address, which is the attack.
  mock.isRateLimited.mockImplementation((bucket: string, limit: number, seconds: number) =>
    bucket.startsWith("signup-mail") ? limiter.hit(bucket, limit, seconds) : Promise.resolve(false));
  mock.rpc.mockResolvedValue({ data: false, error: null });
  mock.maybeSingle.mockResolvedValue({ data: pending, error: null });
  mock.insert.mockResolvedValue({ error: null });
});

it("keys the ceiling on a hash of the normalized address, never the address itself", async () => {
  await askSignup(" Owner@Example.COM ");
  const buckets = mock.isRateLimited.mock.calls.map(([bucket]) => bucket as string).filter(b => b.startsWith("signup-mail"));
  expect(buckets).toEqual([
    `signup-mail-10m:${signupMailKey("owner@example.com")}`,
    `signup-mail-day:${signupMailKey("owner@example.com")}`,
  ]);
  for (const bucket of buckets) expect(bucket.toLowerCase()).not.toContain("owner");
  expect(mock.isRateLimited).toHaveBeenCalledWith(expect.stringMatching(/^signup-mail-10m:/), 1, 600);
  expect(mock.isRateLimited).toHaveBeenCalledWith(expect.stringMatching(/^signup-mail-day:/), 3, 86_400);
});

it("sends one mail per address per 10 minutes across signup and resend, with the same 200 body", async () => {
  const first = await askSignup();
  expect(await first.json()).toEqual({ ok: true, pendingVerification: true });
  expect(mock.after).toHaveBeenCalledTimes(1);

  // Within the cooldown, from either route and any spelling: the same answer, nothing stored or sent.
  const again = await askSignup("OWNER@example.com");
  expect(again.status).toBe(200);
  expect(await again.json()).toEqual({ ok: true, pendingVerification: true });
  const resent = await askResend();
  expect(resent.status).toBe(200);
  expect(await resent.json()).toEqual({ ok: true });
  expect(mock.rpc).toHaveBeenCalledTimes(1);
  expect(mock.insert).not.toHaveBeenCalled();
  expect(mock.after).toHaveBeenCalledTimes(1);

  // Another inbox is not affected.
  await askResend("someone@example.com");
  expect(mock.after).toHaveBeenCalledTimes(2);
});

it("sends at most three per address in a day, whichever route asks", async () => {
  const sends = [askSignup, askResend, askResend, askSignup, askResend];
  for (const ask of sends) {
    await ask();
    limiter.advance(SIGNUP_MAIL_COOLDOWN_SECONDS + 1);
  }
  expect(mock.after).toHaveBeenCalledTimes(SIGNUP_MAILS_PER_DAY);
  // The refused attempts did not open more pending rows either.
  expect(mock.rpc.mock.calls.length + mock.insert.mock.calls.length).toBe(SIGNUP_MAILS_PER_DAY);

  limiter.advance(86_400);
  await askResend();
  expect(mock.after).toHaveBeenCalledTimes(SIGNUP_MAILS_PER_DAY + 1);
});

it("does not spend the day's budget on requests the cooldown already refused", async () => {
  await askSignup();
  for (let i = 0; i < 5; i++) await askResend();
  expect(limiter.buckets.get(`signup-mail-day:${signupMailKey("owner@example.com")}`)?.count).toBe(1);
});
