import { expect, it } from "vitest";
import { sameSitePost } from "@/lib/same-site-post";

const post = (headers: Record<string, string>) => new Request("https://tabletap.shop/auth/callback", { method: "POST", headers });
const origin = "https://tabletap.shop";

it("accepts our own confirm page's post", () => {
  expect(sameSitePost(post({ "sec-fetch-site": "same-origin" }), origin)).toBe(true);
  expect(sameSitePost(post({ origin }), origin)).toBe(true);
});

it("refuses a post from another site (login CSRF)", () => {
  expect(sameSitePost(post({ "sec-fetch-site": "cross-site", origin: "https://evil.example" }), origin)).toBe(false);
  expect(sameSitePost(post({ "sec-fetch-site": "same-site" }), origin)).toBe(false);
  expect(sameSitePost(post({ origin: "https://evil.example" }), origin)).toBe(false);
  expect(sameSitePost(post({}), origin)).toBe(false);
});
