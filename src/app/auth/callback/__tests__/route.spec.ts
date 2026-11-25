import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const { verifyOtp, exchangeCodeForSession } = vi.hoisted(() => ({
  verifyOtp: vi.fn(async () => ({ error: null })),
  exchangeCodeForSession: vi.fn(async () => ({ error: null })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp, exchangeCodeForSession } }),
}));

import { GET, POST } from "../route";

const origin = "https://tabletap.shop";
const tokenHash = "fixture-token-hash";

beforeEach(() => vi.clearAllMocks());

it.each(["signup", "invite", "recovery", "email_change", "email", "magiclink"])(
  "lets a person confirm a legacy %s link before spending its token",
  async type => {
    const query = new URLSearchParams({ token_hash: tokenHash, type, next: "/reset-password", lang: "en" });
    const response = await GET(new NextRequest(`${origin}/auth/callback?${query}`));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `${origin}/auth/confirm?next=%2Freset-password&lang=en#token_hash=${tokenHash}&type=${type}`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  },
);

it("exchanges a PKCE code with the existing GET flow", async () => {
  const response = await GET(new NextRequest(`${origin}/auth/callback?code=fixture-pkce-code`));

  expect(response.headers.get("location")).toBe(`${origin}/dashboard`);
  expect(exchangeCodeForSession).toHaveBeenCalledWith("fixture-pkce-code");
  expect(verifyOtp).not.toHaveBeenCalled();
});

it("spends the email token on confirmation", async () => {
  const response = await POST(new NextRequest(`${origin}/auth/callback`, {
    method: "POST",
    headers: { origin },
    body: new URLSearchParams({ token_hash: tokenHash, type: "recovery", next: "/reset-password" }),
  }));

  expect(response.headers.get("location")).toBe(`${origin}/reset-password`);
  expect(verifyOtp).toHaveBeenCalledWith({ token_hash: tokenHash, type: "recovery" });
});

it("does not verify a token posted from another site", async () => {
  const response = await POST(new NextRequest(`${origin}/auth/callback`, {
    method: "POST",
    headers: { "sec-fetch-site": "cross-site" },
    body: new URLSearchParams({ token_hash: tokenHash, type: "recovery" }),
  }));

  expect(response.headers.get("location")).toBe(`${origin}/login`);
  expect(verifyOtp).not.toHaveBeenCalled();
});
