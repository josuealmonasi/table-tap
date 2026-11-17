import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const token = "11111111-1111-4111-8111-111111111111";
const unknown = "22222222-2222-4222-8222-222222222222";
const state = vi.hoisted(() => ({ patch: null as unknown, token: "", saved: "", limited: false, writes: 0 }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => state.limited }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "es" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => ({
  update: (patch: unknown) => { state.patch = patch; state.writes++; return { eq: (_key: string, value: string) => { state.token = value; return { select: () => ({ maybeSingle: async () => {
    const found = state.saved === value; if (found) state.saved = "";
    return { data: found ? { restaurant_id: "r" } : null, error: null };
  } }) }; } }; },
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: table }, error: null }) }) }),
}) }) }));
const { POST } = await import("@/app/api/tickets/stop/route");
const form = (value: string, body = "List-Unsubscribe=One-Click", contentType = "application/x-www-form-urlencoded") =>
  new NextRequest(`https://example.com/api/tickets/stop?t=${value}`, { method: "POST", headers: { "content-type": contentType }, body });
beforeEach(() => Object.assign(state, { patch: null, token: "", saved: token, limited: false, writes: 0 }));
it("accepts the one-click form and clears the same card address as confirmation", async () => {
  expect((await POST(form(token))).status).toBe(200);
  expect(state.token).toBe(token);
  expect(state.patch).toEqual({ email: null, email_consent_at: null, email_notice_version: null, email_set_by: null, email_unsubscribe: null });
});
it("accepts repeated and unknown one-click tokens without revealing a match", async () => {
  const first = await POST(form(token));
  const repeat = await POST(form(token));
  const missing = await POST(form(unknown));
  expect([first.status, repeat.status, missing.status]).toEqual([200, 200, 200]);
  expect(await first.json()).toEqual(await repeat.json());
  expect(await missing.json()).toEqual({ ok: true });
});
it.each([ ["wrong value", token, "List-Unsubscribe=No", "application/x-www-form-urlencoded"],
  ["missing value", token, "other=One-Click", "application/x-www-form-urlencoded"],
  ["malformed token", "bad", "List-Unsubscribe=One-Click", "application/x-www-form-urlencoded"],
  ["missing multipart boundary", token, "List-Unsubscribe=One-Click", "multipart/form-data"] ])
("rejects %s before updating a card", async (_label, value, body, contentType) => {
  expect((await POST(form(value, body, contentType))).status).toBe(400);
  expect(state.writes).toBe(0);
});
it("rate limits one-click requests before updating a card", async () => {
  state.limited = true;
  expect((await POST(form(token))).status).toBe(429);
  expect(state.writes).toBe(0);
});
it("keeps the confirmation page's unknown token response", async () => {
  const response = await POST(new NextRequest("https://example.com/api/tickets/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: unknown }) }));
  expect(response.status).toBe(404);
});
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: async () => ({}) } }) }));
it("rewrites only a POST to the public stop link, preserving its token", async () => {
  const { middleware } = await import("@/middleware");
  const url = `https://example.com/tickets/stop?t=${token}`;
  const post = await middleware(new NextRequest(url, { method: "POST" }));
  expect(post.headers.get("x-middleware-rewrite")).toBe(url.replace("/tickets/stop", "/api/tickets/stop"));
  const get = await middleware(new NextRequest(url));
  expect(get.headers.get("x-middleware-rewrite")).toBeNull();
});
