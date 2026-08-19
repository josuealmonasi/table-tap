import { describe, expect, it } from "vitest";
import { isValidEmail, normalizeEmail } from "@/lib/email";

describe("an address worth sending a receipt to", () => {
  it("accepts the ones people actually have", () => {
    for (const ok of [
      "diner@example.com",
      "maria.lopez@sakura.com.mx",
      "j+receipts@gmail.com",
      "JOSUE@TABLETAP.MX",
      "a@b.co",
    ]) {
      expect(isValidEmail(ok), ok).toBe(true);
    }
  });

  it("rejects what used to enable the button", () => {
    // The old check was `includes("@")`, so every one of these sent the diner
    // away believing a receipt was coming.
    for (const bad of ["word@", "@example.com", "diner@example", "diner", "@", "a@b"]) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });

  it("rejects a domain that ends in a typo", () => {
    expect(isValidEmail("me@site.c")).toBe(false);
    expect(isValidEmail("me@site.123")).toBe(false);
  });

  it("rejects whitespace, lists and empty input", () => {
    for (const bad of ["", "   ", "a b@c.com", "one@x.com,two@x.com", "one@x.com;two@x.com"]) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });

  it("refuses an address too long to be real", () => {
    expect(isValidEmail(`${"x".repeat(200)}@example.com`)).toBe(false);
  });

  it("sends to the trimmed, lowercased form", () => {
    expect(normalizeEmail("  Diner@Example.COM ")).toBe("diner@example.com");
  });
});
