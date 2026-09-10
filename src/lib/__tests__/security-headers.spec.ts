import { describe, expect, it } from "vitest";
import fs from "node:fs";
import nextConfig from "../../../next.config";
import { contentSecurityPolicy } from "@/lib/csp";

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
    // The old one is here, for the static files the middleware does not run
    // on; the modern one is `frame-ancestors` in the policy it writes.
    expect((await headersFor()).get("x-frame-options")).toBe("DENY");
    expect(contentSecurityPolicy("n", false)).toContain("frame-ancestors 'none'");
  });

  it("lets this app open a camera, and nobody else", async () => {
    // `camera=()` is an EMPTY list and refuses our own page too. It did: the
    // scan-to-collect button shipped and could never open a lens, and the
    // waiter's table scanner would have been dead on arrival beside it.
    const policy = (await headersFor()).get("permissions-policy") ?? "";
    expect(policy).toContain("camera=(self)");
    expect(policy).toContain("microphone=()");
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

  it("writes the policy in one place, not two", async () => {
    // Two Content-Security-Policy headers on one response are both enforced,
    // and the second one is always the one nobody remembers. It carries a
    // per-request nonce, so the middleware owns it.
    expect((await headersFor()).get("content-security-policy")).toBeUndefined();
  });
});

/**
 * What the app is allowed to load, and where it may talk to.
 *
 * Read from the source rather than from a browser, because the browser was
 * asked separately — every screen, both roles, at two widths — and the point
 * of these is to say what must never quietly come back.
 */
describe("the content security policy", () => {
  const live = contentSecurityPolicy("abc123", false);
  const dev = contentSecurityPolicy("abc123", true);
  const preview = contentSecurityPolicy("abc123", false, true);

  it("trusts the nonce it was given, and what that script loads", () => {
    expect(live).toContain("'nonce-abc123'");
    expect(live).toContain("'strict-dynamic'");
  });

  it("does not carry `unsafe-eval` in production", () => {
    // The hot reloader needs it. A policy that ships with it is not a policy.
    expect(live).not.toContain("unsafe-eval");
    expect(dev).toContain("unsafe-eval");
  });

  it("never allows an inline script", () => {
    // The one that would undo the whole thing. Inline STYLE is allowed and has
    // to be — the app styles elements with React's `style` attribute, and a
    // nonce cannot apply to an attribute.
    const scripts = /script-src ([^;]*)/.exec(live)?.[1] ?? "";
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(live).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("lets the browser reach us and our database, and nowhere else", () => {
    // The directive that matters most: a script that somehow ran has no
    // address to send anybody's bill to.
    const connect = /connect-src ([^;]*)/.exec(live)?.[1] ?? "";
    expect(connect.split(" ").filter(Boolean).sort()).toEqual([
      "'self'",
      "https://*.supabase.co",
      "wss://*.supabase.co",
    ]);
  });

  it("keeps localhost out of the live policy", () => {
    expect(live).not.toContain("localhost");
    expect(live).not.toContain("127.0.0.1");
    expect(dev).toContain("ws://127.0.0.1:*");
  });

  it("shuts the doors nothing in this app uses", () => {
    for (const shut of [
      "object-src 'none'",
      "frame-src 'none'",
      "frame-ancestors 'none'",
      // A `<base>` somebody injected rewrites every relative URL on the page,
      // including the ones that post money.
      "base-uri 'none'",
      "form-action 'self'",
    ]) {
      expect(live).toContain(shut);
    }
  });

  it("still allows what the app actually loads", () => {
    // Menu photography, the offline worker for the kitchen board, and the
    // fonts `next/font` self-hosts.
    expect(live).toContain("img-src 'self' data: blob: https://*.supabase.co");
    expect(live).toContain("worker-src 'self' blob:");
    expect(live).toContain("font-src 'self' data:");
  });

  it("upgrades http in production and leaves the dev server alone", () => {
    expect(live).toContain("upgrade-insecure-requests");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("lets a preview keep the toolbar its pull requests are commented on", () => {
    // A preview is a real production build, so it gets none of the
    // development allowances — only this, and only there.
    expect(preview).toContain("https://vercel.live");
    expect(preview).not.toContain("unsafe-eval");
    expect(live).not.toContain("vercel.live");
    expect(dev).not.toContain("vercel.live");
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
