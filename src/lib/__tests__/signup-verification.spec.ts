import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { signupHash } from "@/lib/pending-signup";

const mock = vi.hoisted(() => ({
  after: vi.fn(), create: vi.fn(), resend: vi.fn(), mail: vi.fn(),
  rpc: vi.fn(), insert: vi.fn(), select: vi.fn(), eq: vi.fn(), gt: vi.fn(),
  order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(), isRateLimited: vi.fn(),
}));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: mock.after }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({ clientKey: () => "ip", isRateLimited: mock.isRateLimited }));
vi.mock("@/lib/mail", () => ({ sendMail: mock.mail }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  auth: { admin: { createUser: mock.create }, resend: mock.resend },
  from: () => ({
    insert: mock.insert,
    select: mock.select.mockReturnThis(),
    eq: mock.eq.mockReturnThis(),
    gt: mock.gt.mockReturnThis(),
    order: mock.order.mockReturnThis(),
    limit: mock.limit.mockReturnThis(),
    maybeSingle: mock.maybeSingle,
  }),
  rpc: mock.rpc,
}) }));

import { POST as signup } from "@/app/api/signup/route";
import { POST as confirm } from "@/app/api/signup/confirm/route";
import { POST as resend } from "@/app/api/signup/resend/route";

const token = "1".repeat(64);
const password = "Restaurant password";
const payload = { email: "owner@example.com", restaurantName: "Cafe", locale: "es", termsVersion: "v1", termsTextHash: "hash" };
const signupBody = { restaurantName: " Cafe ", email: " Owner@Example.com ", acceptedTerms: true };
const request = (path: string, fields: object, locale = "en") => new NextRequest(`https://tabletap.shop/api/signup${path}`, {
  method: "POST", headers: { Cookie: `tt-locale=${locale}`, Origin: "https://another.example" },
  body: JSON.stringify(fields),
});
const deliverMail = () => mock.after.mock.lastCall?.[0]();

beforeEach(() => {
  vi.clearAllMocks();
  mock.isRateLimited.mockResolvedValue(false);
  mock.rpc.mockResolvedValue({ data: false, error: null });
  mock.maybeSingle.mockResolvedValue({ data: null, error: null });
  mock.insert.mockResolvedValue({ error: null });
  mock.create.mockResolvedValue({ data: { user: { id: "owner" } }, error: null });
  mock.mail.mockResolvedValue({ sent: true });
  mock.resend.mockResolvedValue({ error: null });
});

it("prepares a password-free signup without creating Auth or restaurant records", async () => {
  // An older client may still send a password. It must never reach storage.
  const res = await signup(request("", { ...signupBody, password }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, pendingVerification: true });
  expect(mock.isRateLimited).toHaveBeenCalledWith("signup:ip", 5, 60);
  expect(mock.create).not.toHaveBeenCalled();
  expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("request_pending_signup_v1", {
    p_email: payload.email, p_restaurant_name: payload.restaurantName, p_locale: "en",
    p_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    p_terms_version: expect.any(String), p_terms_text_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(mock.mail).not.toHaveBeenCalled();
  await deliverMail();
  const mail = mock.mail.mock.lastCall?.[0];
  expect(mail).toMatchObject({ to: payload.email, subject: "Confirm your TableTap signup" });
  const mailedToken = mail.text.match(/https:\/\/tabletap\.shop\/signup\/confirm#token=([a-f0-9]{64})/)?.[1];
  expect(mailedToken).toBeDefined();
  expect(mock.rpc.mock.lastCall?.[1].p_token_hash).toBe(signupHash(mailedToken!));
});

it("returns the same 200 response for an existing email and sends sign-in and reset links", async () => {
  const fresh = await signup(request("", signupBody));
  mock.rpc.mockResolvedValue({ data: true, error: null });
  const existing = await signup(request("", signupBody, "es"));
  expect(existing.status).toBe(fresh.status);
  expect(await existing.json()).toEqual(await fresh.json());
  await deliverMail();
  expect(mock.mail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    to: payload.email, subject: "Ya tienes una cuenta de TableTap",
    html: expect.stringContaining('href="https://tabletap.shop/login"'),
    text: expect.stringContaining("https://tabletap.shop/forgot-password"),
  }));
  expect(mock.mail.mock.lastCall?.[0].text).not.toContain("token=");
  expect(mock.create).not.toHaveBeenCalled();
});

it("keeps the same success response when the mail provider refuses delivery", async () => {
  mock.mail.mockResolvedValueOnce({ sent: false, reason: "unconfigured" });
  const res = await signup(request("", signupBody));
  await deliverMail();
  expect(await res.json()).toEqual({ ok: true, pendingVerification: true });
});

it("requires the signup terms checkbox and preserves the signup rate limit", async () => {
  expect((await signup(request("", { ...signupBody, acceptedTerms: "yes" }))).status).toBe(400);
  mock.isRateLimited.mockResolvedValueOnce(true);
  expect((await signup(request("", signupBody))).status).toBe(429);
  expect(mock.rpc).not.toHaveBeenCalled();
});

it("only creates a confirmed user using the email and locale from the pending row", async () => {
  mock.maybeSingle.mockResolvedValueOnce({ data: { id: "pending", payload }, error: null });
  const res = await confirm(request("/confirm", { token, password, email: "another@example.com" }));
  expect(res.status).toBe(200);
  expect(mock.eq).toHaveBeenCalledWith("token_hash", signupHash(token));
  expect(mock.gt).toHaveBeenCalledWith("expires_at", expect.any(String));
  expect(mock.create).toHaveBeenCalledExactlyOnceWith({
    email: payload.email, password, email_confirm: true,
    user_metadata: { locale: payload.locale }, app_metadata: { pending_signup_id: "pending" },
  });
});

it("refuses a row that has expired or been consumed before calling Auth", async () => {
  mock.maybeSingle.mockImplementationOnce(async () => {
    const [, cutoff] = mock.gt.mock.lastCall ?? [];
    expect(Date.parse(cutoff)).toBeGreaterThan(Date.now() - 60_000);
    return { data: null, error: null };
  });
  const res = await confirm(request("/confirm", { token, password }));
  expect(res.status).toBe(410);
  expect(await res.json()).toEqual({ error: "auth.signupLinkInvalid" });
  expect(mock.create).not.toHaveBeenCalled();
});

it("refuses a malformed token or short password before looking up a signup", async () => {
  expect((await confirm(request("/confirm", { token: "bad", password }))).status).toBe(410);
  expect((await confirm(request("/confirm", { token, password: "short" }))).status).toBe(400);
  expect(mock.select).not.toHaveBeenCalled();
});

it("resends a new token in the signup language with the original expiry", async () => {
  const expires_at = new Date(Date.now() + 60_000).toISOString();
  mock.maybeSingle.mockResolvedValueOnce({ data: { payload, expires_at }, error: null });
  const res = await resend(request("/resend", { email: signupBody.email }));
  expect(await res.json()).toEqual({ ok: true });
  expect(mock.eq).toHaveBeenCalledWith("email_hash", signupHash(payload.email));
  expect(mock.insert).toHaveBeenCalledExactlyOnceWith({
    email_hash: signupHash(payload.email), token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    payload, expires_at,
  });
  await deliverMail();
  expect(mock.mail).toHaveBeenCalledWith(expect.objectContaining({ subject: "Confirma tu registro en TableTap" }));
  expect(mock.resend).not.toHaveBeenCalled();
});

it("still resends legacy Auth links and preserves the resend rate limit", async () => {
  const res = await resend(request("/resend", { email: payload.email }));
  expect(await res.json()).toEqual({ ok: true });
  await deliverMail();
  expect(mock.resend).toHaveBeenCalledWith({ type: "signup", email: payload.email,
    options: { emailRedirectTo: "https://tabletap.shop/auth/callback?next=/signup/complete" } });
  expect(mock.isRateLimited).toHaveBeenCalledWith("signup-resend:ip", 5, 60);
  mock.isRateLimited.mockResolvedValueOnce(true);
  expect((await resend(request("/resend", { email: payload.email }))).status).toBe(429);
});
it("the signup trigger provisions once: an already-confirmed user's later update returns before anything runs", async () => {
  const { readFileSync } = await import("node:fs");
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const start = schema.indexOf("create or replace function public.provision_pending_signup_v1()");
  const body = schema.slice(start, schema.indexOf("$$;", start));
  const guard = body.indexOf("if tg_op = 'UPDATE' and old.email_confirmed_at is not null then return new; end if;");
  expect(start).toBeGreaterThan(-1);
  expect(guard).toBeGreaterThan(-1);
  expect(guard).toBeLessThan(body.indexOf("delete from public.pending_signups"));
  expect(guard).toBeLessThan(body.indexOf("signup_restaurant_with_terms_v1"));
});
