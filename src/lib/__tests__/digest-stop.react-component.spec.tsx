import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { digestEnabled } from "@/lib/digest-preference";
import { digestStopToken } from "@/lib/digest-stop-token";
import { POST } from "@/app/api/digest/opt-out/route";
import StopDigestPage from "@/app/digest/opt-out/page";

const { updateUserById } = vi.hoisted(() => ({ updateUserById: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ auth: { admin: { updateUserById } } }) }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "es" }));

const user = "11111111-1111-4111-8111-111111111111";
const request = (token: string, body: string) => new NextRequest(`https://test.example/api/digest/opt-out?t=${token}`, {
  method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" },
});
beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "digest-fixture-secret");
  updateUserById.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  ["owner", undefined, true], ["owner", false, false], ["manager", undefined, false],
  ["manager", true, true], ["manager", "true", false], ["kitchen", true, false],
] as const)("uses the management preference for %s with %s", (role, saved, enabled) => {
  expect(digestEnabled(role, saved)).toBe(enabled);
});

it("renders the localized confirmation without changing a preference on link open", async () => {
  const t = digestStopToken(user, "en");
  const page = await StopDigestPage({ searchParams: Promise.resolve({ t }) });
  const html = renderToStaticMarkup(page);
  expect(html).toContain("Stop receiving this digest");
  expect(html).toContain("/api/digest/opt-out?t=" + t);
  expect(updateUserById).not.toHaveBeenCalled();
});

it("opts out through the footer button and returns a confirmation in the signed language", async () => {
  const answer = await POST(request(digestStopToken(user, "es"), "stopDigest=1"));
  expect(answer.status).toBe(303);
  expect(answer.headers.get("location")).toBe("https://test.example/digest/opt-out?stopped=1&lang=es");
  expect(updateUserById).toHaveBeenCalledExactlyOnceWith(user, { user_metadata: { digest: false } });
  const page = await StopDigestPage({ searchParams: Promise.resolve({ stopped: "1", lang: "es" }) });
  expect(renderToStaticMarkup(page)).toContain("Ya no recibirás el resumen diario de ventas");
});

it("accepts an idempotent one-click mail provider POST without requiring a session", async () => {
  const token = digestStopToken(user, "en");
  for (let i = 0; i < 2; i++) {
    const answer = await POST(request(token, "List-Unsubscribe=One-Click"));
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ ok: true });
  }
  expect(updateUserById).toHaveBeenCalledTimes(2);
  for (const call of updateUserById.mock.calls) expect(call).toEqual([user, { user_metadata: { digest: false } }]);
});

it("rejects a different login, a changed locale, and a malformed POST", async () => {
  const token = digestStopToken(user, "en");
  expect((await POST(request(token.replace(/^1/, "2"), "List-Unsubscribe=One-Click"))).status).toBe(400);
  expect((await POST(request(token.replace(".en.", ".es."), "List-Unsubscribe=One-Click"))).status).toBe(400);
  expect((await POST(request(token, "List-Unsubscribe=No"))).status).toBe(400);
  expect(updateUserById).not.toHaveBeenCalled();
});
