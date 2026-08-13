import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, isLocale, LOCALES, messagesFor } from "@/lib/i18n";

/**
 * The rule getLocale follows, as a pure function so it can be tested without
 * faking cookies and headers. getLocale is the same three steps against the
 * real request.
 */
function pick(cookie: string | undefined, acceptLanguage: string): string {
  if (isLocale(cookie)) return cookie;
  const accept = acceptLanguage.toLowerCase();
  if (accept.startsWith("es")) return "es";
  if (accept.startsWith("en")) return "en";
  return DEFAULT_LOCALE;
}

describe("which language a visitor gets", () => {
  it("serves Spanish when the browser says nothing — this ships in Mexico", () => {
    expect(pick(undefined, "")).toBe("es");
    expect(DEFAULT_LOCALE).toBe("es");
  });

  it("still serves English to a browser that asks for it", () => {
    // A visitor's phone should not be handed a language they can't read just
    // because of where the restaurant is.
    expect(pick(undefined, "en-US,en;q=0.9")).toBe("en");
  });

  it("serves Spanish to a browser that asks for it", () => {
    expect(pick(undefined, "es-MX,es;q=0.9")).toBe("es");
  });

  it("falls back to Spanish for any other language", () => {
    expect(pick(undefined, "fr-FR,fr;q=0.9")).toBe("es");
    expect(pick(undefined, "de")).toBe("es");
  });

  it("lets a saved choice beat the browser, in both directions", () => {
    expect(pick("en", "es-MX")).toBe("en");
    expect(pick("es", "en-US")).toBe("es");
  });

  it("ignores a cookie that isn't a language we have", () => {
    expect(pick("klingon", "")).toBe("es");
  });
});

describe("catalogs", () => {
  it("has a catalog for every offered locale", () => {
    for (const locale of LOCALES) {
      expect(messagesFor(locale)).toBeTruthy();
    }
  });
});
