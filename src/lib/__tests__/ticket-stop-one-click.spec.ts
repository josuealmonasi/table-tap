import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ patch: null as unknown, token: "" }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => ({
  update: (patch: unknown) => { state.patch = patch; return { eq: (_key: string, token: string) => { state.token = token; return { select: () => ({ maybeSingle: async () => ({ data: { restaurant_id: "r" }, error: null }) }) }; } }; },
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: table }, error: null }) }) }),
}) }) }));
const { POST } = await import("@/app/api/tickets/stop/route");
it("accepts the one-click form and clears the same card address as confirmation", async () => {
  const token = "11111111-1111-4111-8111-111111111111";
  const response = await POST(new NextRequest(`https://example.com/api/tickets/stop?t=${token}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }));
  expect(response.status).toBe(200);
  expect(state.token).toBe(token);
  expect(state.patch).toEqual({ email: null, email_consent_at: null, email_notice_version: null, email_set_by: null, email_unsubscribe: null });
});

vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: async () => ({}) } }) }));
it("rewrites only a POST to the public stop link, preserving its token", async () => {
  const { middleware } = await import("@/middleware");
  const url = "https://example.com/tickets/stop?t=11111111-1111-4111-8111-111111111111";
  const post = await middleware(new NextRequest(url, { method: "POST" }));
  expect(post.headers.get("x-middleware-rewrite")).toBe(url.replace("/tickets/stop", "/api/tickets/stop"));
  const get = await middleware(new NextRequest(url));
  expect(get.headers.get("x-middleware-rewrite")).toBeNull();
});
