import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { digestEnabled } from "@/lib/digest-preference";
import { digestStopToken, readDigestStopToken } from "@/lib/digest-stop-token";
import { POST } from "@/app/api/digest/opt-out/route";
import { POST as stopOutsideDigest } from "@/app/api/digest/stop/route";
import type { Locale } from "@/lib/i18n";
import StopDigestPage from "@/app/digest/opt-out/page";

const { rpc, stopRecipient } = vi.hoisted(() => ({ rpc: vi.fn(), stopRecipient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/digest-recipients", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/digest-recipients")>(), stopRecipient,
}));
vi.mock("@/lib/rate-limit", () => ({ clientKey: () => "fixture", isRateLimited: async () => false, isRoomLimited: async () => false }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "es" }));

const user = "11111111-1111-4111-8111-111111111111";
const restaurant = "33333333-3333-4333-8333-333333333333";
const version = "44444444-4444-4444-8444-444444444444";
const address = "b".repeat(64);
const tokenFor = (locale: Locale, preferenceVersion = version) => digestStopToken({
  restaurantId: restaurant, userId: user, locale, version: preferenceVersion, addressKey: address,
});
const stopArgs = ["stop_digest_staff_v2", {
  p_restaurant: restaurant, p_user: user, p_address: address, p_version: version,
}];
const request = (token: string, body: string) => new NextRequest(`https://test.example/api/digest/opt-out?t=${token}`, {
  method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" },
});
beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "digest-fixture-secret");
  rpc.mockReset().mockResolvedValue({ data: true, error: null });
  stopRecipient.mockReset().mockResolvedValue("Bistro");
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  ["owner", undefined, true], ["owner", false, false], ["manager", undefined, false],
  ["manager", true, true], ["manager", "true", false], ["kitchen", true, false],
] as const)("uses the management preference for %s with %s", (role, saved, enabled) => {
  expect(digestEnabled(role, saved)).toBe(enabled);
});

it("renders the localized confirmation without changing a preference on link open", async () => {
  const t = tokenFor("en");
  const page = await StopDigestPage({ searchParams: Promise.resolve({ t }) });
  const html = renderToStaticMarkup(page);
  expect(html).toContain("Stop receiving this digest");
  expect(html).toContain("/api/digest/opt-out?t=" + t);
  expect(rpc).not.toHaveBeenCalled();
});

it("opts out through the footer button and returns a confirmation in the signed language", async () => {
  const answer = await POST(request(tokenFor("es"), "stopDigest=1"));
  expect(answer.status).toBe(303);
  expect(answer.headers.get("location")).toBe("https://test.example/digest/opt-out?stopped=1&lang=es");
  expect(rpc).toHaveBeenCalledExactlyOnceWith(...stopArgs);
  const page = await StopDigestPage({ searchParams: Promise.resolve({ stopped: "1", lang: "es" }) });
  expect(renderToStaticMarkup(page)).toContain("Ya no recibirás el resumen diario de ventas");
});

it("accepts an idempotent one-click mail provider POST without requiring a session", async () => {
  const token = tokenFor("en");
  for (let i = 0; i < 2; i++) {
    const answer = await POST(request(token, "List-Unsubscribe=One-Click"));
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ ok: true });
  }
  expect(rpc).toHaveBeenCalledTimes(2);
  for (const call of rpc.mock.calls) expect(call).toEqual(stopArgs);
});

it("rejects a different login, a changed locale, and a malformed POST", async () => {
  const token = tokenFor("en");
  expect((await POST(request(token.replace(user, restaurant), "List-Unsubscribe=One-Click"))).status).toBe(400);
  expect((await POST(request(token.replace(restaurant, user), "List-Unsubscribe=One-Click"))).status).toBe(400);
  expect((await POST(request(token.replace(".en.", ".es."), "List-Unsubscribe=One-Click"))).status).toBe(400);
  expect((await POST(request(token, "List-Unsubscribe=No"))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});

it("accepts the outside recipient's footer button and the mail client's one-click form", async () => {
  const url = "https://test.example/api/digest/stop";
  const token = "a".repeat(43);
  const fromButton = new NextRequest(url, {
    method: "POST", body: JSON.stringify({ token }), headers: { "content-type": "application/json" },
  });
  const fromMail = new NextRequest(`${url}?t=${token}`, {
    method: "POST", body: new URLSearchParams({ "List-Unsubscribe": "One-Click" }),
  });
  for (const req of [fromButton, fromMail]) expect((await stopOutsideDigest(req)).status).toBe(200);
  expect(stopRecipient.mock.calls).toEqual([[token], [token]]);
});

it("requires the one-click form when the outside stop token is in the URL", async () => {
  const req = new NextRequest(`https://test.example/api/digest/stop?t=${"a".repeat(43)}`, { method: "POST" });
  expect((await stopOutsideDigest(req)).status).toBe(400);
  expect(stopRecipient).not.toHaveBeenCalled();
});

it("rejects a signed link whose preference version was superseded by a new opt-in", async () => {
  rpc.mockImplementation(async (_name: string, args: { p_version: string }) => ({
    data: args.p_version === version, error: null,
  }));
  const stale = tokenFor("en", "0");
  expect(readDigestStopToken(stale)?.version).toBe("0");
  expect((await POST(request(stale, "List-Unsubscribe=One-Click"))).status).toBe(400);
  expect((await POST(request(tokenFor("en"), "List-Unsubscribe=One-Click"))).status).toBe(200);
});
