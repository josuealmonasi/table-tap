import { describe, expect, it, afterEach } from "vitest";
import { browserCookieOptions } from "@/lib/supabase/cookie-options";

const setProtocol = (value: string) => {
  Object.defineProperty(globalThis, "location", {
    value: { protocol: value },
    configurable: true,
    writable: true,
  });
};

describe("the session cookie's Secure flag", () => {
  afterEach(() => setProtocol("http:"));

  it("is set when the page is served over https", () => {
    setProtocol("https:");
    expect(browserCookieOptions().secure).toBe(true);
  });

  it("is NOT set on plain http, or nobody could log in locally", () => {
    // A Secure cookie sent over http is silently dropped by the browser. This
    // is why the flag follows the protocol rather than a build variable: a
    // build variable has to be guessed right for an environment it can never
    // be tested in, and guessing wrong locks everyone out.
    setProtocol("http:");
    expect(browserCookieOptions().secure).toBe(false);
  });
});
