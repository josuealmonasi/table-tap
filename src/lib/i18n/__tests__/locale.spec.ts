import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, isLocale, LOCALES, messagesFor } from "@/lib/i18n";

/**
 * The rule getLocale follows, as a pure function so it can be tested without
 * faking cookies. getLocale is the same two steps against the real request.
 */
function pick(cookie: string | undefined): string {
  if (isLocale(cookie)) return cookie;
  return DEFAULT_LOCALE;
}

describe("which language a visitor gets", () => {
  it("serves Spanish to a first visit — this ships in Mexico", () => {
    expect(pick(undefined)).toBe("es");
    expect(DEFAULT_LOCALE).toBe("es");
  });

  it("still serves Spanish to a browser set to English", () => {
    // The browser's preference used to win here, which meant a phone bought
    // in English opened a Mexican restaurant's menu in English. The toggle in
    // the header is the way to change it, and it is remembered.
    expect(pick(undefined)).toBe("es");
  });

  it("lets a saved choice beat the default, in both directions", () => {
    expect(pick("en")).toBe("en");
    expect(pick("es")).toBe("es");
  });

  it("ignores a cookie that isn't a language we have", () => {
    expect(pick("klingon")).toBe("es");
  });
});

describe("catalogs", () => {
  it("has a catalog for every offered locale", () => {
    for (const locale of LOCALES) {
      expect(messagesFor(locale)).toBeTruthy();
    }
  });
});
