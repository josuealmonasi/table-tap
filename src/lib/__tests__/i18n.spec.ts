import { describe, it, expect } from "vitest";
import { translate, messagesFor, isLocale, LOCALES, LOCALE_LABELS } from "@/lib/i18n";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

describe("translate", () => {
  it("resolves a dotted key against the catalog", () => {
    expect(translate(en, "lang.label")).toBe("Language");
    expect(translate(es, "lang.label")).toBe("Idioma");
  });

  it("fills in {vars}", () => {
    expect(translate(en, "menu.table", { label: "7" })).toBe("🪑 Table 7");
  });

  it("replaces every occurrence of a var", () => {
    const msgs = { greet: "{x} and {x}" } as unknown as typeof en;
    expect(translate(msgs, "greet", { x: "hi" })).toBe("hi and hi");
  });

  it("returns the key itself when it's missing (so gaps are visible)", () => {
    expect(translate(en, "does.not.exist")).toBe("does.not.exist");
  });

  it("returns the key when it resolves to a non-string (a nested object)", () => {
    expect(translate(en, "lang")).toBe("lang");
  });

  it("coerces numeric vars to strings", () => {
    expect(translate(en, "menu.table", { label: 12 })).toBe("🪑 Table 12");
  });
});

describe("messagesFor", () => {
  it("returns the matching catalog", () => {
    expect(messagesFor("es")).toBe(es);
    expect(messagesFor("en")).toBe(en);
  });
});

describe("isLocale", () => {
  it("accepts supported locales", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("es")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale("")).toBe(false);
  });
});

describe("LOCALE_LABELS", () => {
  it("has a label row for every supported locale", () => {
    for (const code of LOCALES) {
      const label = LOCALE_LABELS[code];
      expect(label.flag).toBeTruthy();
      expect(label.name).toBeTruthy();
      expect(label.short).toBeTruthy();
    }
  });
});
