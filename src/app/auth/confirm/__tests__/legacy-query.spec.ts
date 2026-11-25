import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import { middleware } from "@/middleware";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn(async () => ({})) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser } }) }));

const confirmUrl = "https://tabletap.shop/auth/confirm";

beforeEach(() => vi.clearAllMocks());

it("moves a legacy query token into the fragment with one 302", async () => {
  const response = await middleware(new NextRequest(
    `${confirmUrl}?token_hash=fixture-token&token_hash=duplicate&type=recovery&next=%2Freset-password&lang=en`,
  ));

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(
    `${confirmUrl}?next=%2Freset-password&lang=en#token_hash=fixture-token&type=recovery`,
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(getUser).not.toHaveBeenCalled();

  const location = new URL(response.headers.get("location")!);
  location.hash = ""; // The browser omits the fragment in its follow-up request.
  const followUp = await middleware(new NextRequest(location));
  expect(followUp.headers.get("location")).toBeNull();
  expect(followUp.headers.get("x-middleware-next")).toBe("1");
});

it("drops an empty legacy token from the query too", async () => {
  const response = await middleware(new NextRequest(`${confirmUrl}?token_hash=&lang=es`));

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(`${confirmUrl}?lang=es#token_hash=`);
});
