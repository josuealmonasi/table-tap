import { describe, expect, it } from "vitest";
import fs from "node:fs";
import nextConfig from "../../../next.config";

/**
 * The headers every response carries.
 *
 * Vercel sends HSTS on its own and nothing else, which left the one gap this
 * app cannot afford: the dashboard settles bills, approves refunds and writes
 * off tables, so a page able to frame it can put its own buttons on top and
 * let a signed-in manager click them. These assert the header is configured at
 * all — the browser was asked separately whether it actually refuses, and it
 * does.
 */
describe("security headers", () => {
  async function headersFor(): Promise<Map<string, string>> {
    const rules = await nextConfig.headers!();
    const out = new Map<string, string>();
    for (const rule of rules) {
      // Every rule in this config is a catch-all; if one ever is not, this
      // test should be taught the matching rather than quietly skipping it.
      expect(rule.source, "a non-catch-all rule needs real path matching here").toBe("/:path*");
      for (const h of rule.headers) out.set(h.key.toLowerCase(), h.value);
    }
    return out;
  }

  it("refuses to be framed, by both the old header and the modern one", async () => {
    const h = await headersFor();
    expect(h.get("x-frame-options")).toBe("DENY");
    expect(h.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("serves a file as what it says it is, never as what the bytes look like", async () => {
    expect((await headersFor()).get("x-content-type-options")).toBe("nosniff");
  });

  it("does not hand an order's URL to another site", async () => {
    // An order URL names an order. Off-site requests get the origin only.
    expect((await headersFor()).get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("never restricts payment — money gets no speculative header", async () => {
    // Checkout is a full-page redirect today, so denying `payment` would
    // change nothing. The day somebody puts Apple Pay on our own page, a
    // header nobody remembers writing is a bad way to find out.
    expect((await headersFor()).get("permissions-policy")).not.toContain("payment");
  });

  it("claims no Content-Security-Policy beyond framing", async () => {
    // A real CSP has to be tested against Stripe, Supabase and the fonts. A
    // half-written one either blocks checkout or lulls somebody into thinking
    // the app has one.
    const csp = (await headersFor()).get("content-security-policy") ?? "";
    expect(csp.split(";").filter(Boolean)).toHaveLength(1);
  });
});

describe("the shipped framework is a patched one", () => {
  it("pins Next past the unauthenticated RCE advisories", () => {
    // GHSA-2xp9-vwfh-vxw4 (CVSS 9.5, AVIF image optimisation) and
    // GHSA-p293-qw3h-jr36 are both fixed in 15.5.24; the App Router DoS and
    // the two SSRFs in 15.5.21. A range that can resolve below 15.5.24 puts
    // an unauthenticated RCE back into a production install.
    const { dependencies } = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const floor = dependencies.next.replace(/^[\^~]/, "");
    const [maj, min, patch] = floor.split(".").map(Number);
    expect(maj).toBeGreaterThanOrEqual(15);
    if (maj === 15 && min === 5) expect(patch).toBeGreaterThanOrEqual(24);
  });
});
