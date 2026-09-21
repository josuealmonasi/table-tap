import { describe, expect, it } from "vitest";
import { ALLOWED_ZONES, isAllowedTimeZone, offsetLabel, ZONE_GROUPS } from "@/lib/timezones";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

/**
 * The list is data, and data with two ways to be wrong that nothing else
 * catches: a zone name the runtime has never heard of, and a label key with no
 * words behind it. Neither is a type error — `zone` and `labelKey` are both
 * strings — and both reach a restaurant choosing where it is.
 */
const resolve = (dict: unknown, key: string): unknown =>
  key.split(".").reduce<unknown>(
    (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
    dict,
  );

describe("every zone offered is a zone that exists", () => {
  it("formats a date in each one", () => {
    // Asked of the runtime rather than read off the list: a typo like
    // "America/Mexico_city" looks right and throws when somebody picks it.
    const broken: string[] = [];
    for (const zone of ALLOWED_ZONES) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
      } catch {
        broken.push(zone);
      }
    }
    expect(broken, `the runtime does not know these zones:\n${broken.join("\n")}`).toEqual([]);
  });

  it("offers each one only once", () => {
    expect(ALLOWED_ZONES.length).toBe(new Set(ALLOWED_ZONES).size);
  });

  it("accepts what it offers and nothing else", () => {
    for (const zone of ALLOWED_ZONES) expect(isAllowedTimeZone(zone)).toBe(true);
    // An IANA zone the runtime knows perfectly well, which we still do not
    // offer — the point of the list is that it is short.
    expect(isAllowedTimeZone("Europe/Madrid")).toBe(false);
    expect(isAllowedTimeZone("")).toBe(false);
    expect(isAllowedTimeZone("America/Mexico_city")).toBe(false);
  });
});

describe("every label has words behind it", () => {
  it("resolves each group heading and each city, in both languages", () => {
    const missing: string[] = [];
    for (const group of ZONE_GROUPS) {
      for (const key of [group.labelKey, ...group.zones.map(z => z.labelKey)]) {
        if (typeof resolve(en, key) !== "string") missing.push(`en: ${key}`);
        if (typeof resolve(es, key) !== "string") missing.push(`es: ${key}`);
      }
    }
    expect(missing, `these would show as the key itself:\n${missing.join("\n")}`).toEqual([]);
  });
});

describe("the offset shown beside a city", () => {
  it("reads as an offset", () => {
    for (const zone of ALLOWED_ZONES) {
      expect(offsetLabel(zone), zone).toMatch(/^GMT[+-]\d{1,2}(:\d{2})?$/);
    }
  });

  it("follows daylight saving where a zone still has any", () => {
    const july = new Date("2026-07-15T18:00:00Z");
    const january = new Date("2026-01-15T18:00:00Z");
    // These move their clocks, so the label has to be worked out at the
    // moment it is asked rather than stored.
    for (const zone of ["America/New_York", "America/Chicago", "America/Tijuana"]) {
      expect(offsetLabel(zone, july), zone).not.toBe(offsetLabel(zone, january));
    }
    // And these do not. Mexico stopped changing its clocks in 2022, and
    // Phoenix never did.
    for (const zone of ["America/Mexico_City", "America/Cancun", "America/Phoenix"]) {
      expect(offsetLabel(zone, july), zone).toBe(offsetLabel(zone, january));
    }
  });

  it("keeps Cancún and Mérida an hour apart all year", () => {
    // Both are on the list because Quintana Roo is on GMT-5 and Yucatán on
    // GMT-6 — a real hour, in January as much as in July. Offering a
    // restaurant in one only the other puts its whole menu schedule out.
    for (const at of [new Date("2026-07-15T18:00:00Z"), new Date("2026-01-15T18:00:00Z")]) {
      expect(offsetLabel("America/Cancun", at)).toBe("GMT-5");
      expect(offsetLabel("America/Merida", at)).toBe("GMT-6");
    }
  });

  it("says nothing rather than throwing on a zone it cannot format", () => {
    expect(offsetLabel("Not/AZone")).toBe("");
  });
});
