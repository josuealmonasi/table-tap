import { describe, expect, it } from "vitest";
import { elapsedMinutes, formatAgo, formatDuration } from "@/lib/elapsed";

const NOW = Date.parse("2026-11-12T18:00:00Z");
const MIN = 60_000;
const before = (ms: number) => new Date(NOW - ms).toISOString();

// [label, how long ago, Spanish, English]
const AGO: [string, number, string, string][] = [
  ["0", 0, "ahora", "just now"],
  ["59 s", 59_000, "ahora", "just now"],
  ["1 min", MIN, "hace 1 min", "1 min ago"],
  ["59 min", 59 * MIN, "hace 59 min", "59 min ago"],
  ["60 min", 60 * MIN, "hace 1 h", "1 h ago"],
  ["61 min", 61 * MIN, "hace 1 h 1 min", "1 h 1 min ago"],
  ["2 h 15 min", 135 * MIN, "hace 2 h 15 min", "2 h 15 min ago"],
  ["23 h 59 min", (23 * 60 + 59) * MIN, "hace 23 h 59 min", "23 h 59 min ago"],
  ["24 h", 24 * 60 * MIN, "hace 1 d", "1 d ago"],
  ["1741 min", 1741 * MIN, "hace 1 d 5 h", "1 d 5 h ago"],
  ["6 d 23 h", (6 * 24 + 23) * 60 * MIN, "hace 6 d 23 h", "6 d 23 h ago"],
  ["6 d 23 h 59 min", ((6 * 24 + 23) * 60 + 59) * MIN, "hace 6 d 23 h", "6 d 23 h ago"],
];

describe("formatAgo", () => {
  it.each(AGO)("%s reads in both languages", (_label, ago, es, en) => {
    expect(formatAgo(before(ago), NOW, "es")).toBe(es);
    expect(formatAgo(before(ago), NOW, "en")).toBe(en);
  });

  it("gives the date from seven days on, in the restaurant's time zone", () => {
    const sevenDays = before(7 * 24 * 60 * MIN); // 2026-11-05T18:00Z
    expect(formatAgo(sevenDays, NOW, "es", "America/Mexico_City")).toBe("el 5 nov");
    expect(formatAgo(sevenDays, NOW, "en", "America/Mexico_City")).toBe("on Nov 5");
    // 02:00 UTC on the 3rd is still the 2nd in Mexico City.
    const lateNight = "2026-11-03T02:00:00Z";
    expect(formatAgo(lateNight, NOW, "es", "America/Mexico_City")).toBe("el 2 nov");
    expect(formatAgo(lateNight, NOW, "en", "UTC")).toBe("on Nov 3");
  });

  it("never says a time in the future or an unreadable one is ago", () => {
    expect(formatAgo(before(-5 * MIN), NOW, "es")).toBe("ahora");
    expect(formatAgo("not a date", NOW, "en")).toBe("just now");
  });

  it("accepts a timestamp in milliseconds", () => {
    expect(formatAgo(NOW - 1741 * MIN, NOW, "es")).toBe("hace 1 d 5 h");
  });

  it("never prints more than 59 of a smaller unit", () => {
    for (let m = 0; m < 7 * 24 * 60; m += 7) {
      const text = formatAgo(before(m * MIN), NOW, "es");
      for (const [, n, unit] of text.matchAll(/(\d+) (min|h)\b/g)) {
        expect(Number(n), text).toBeLessThan(unit === "min" ? 60 : 24);
      }
    }
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "menos de 1 min", "under 1 min"],
    [1, "1 min", "1 min"],
    [59, "59 min", "59 min"],
    [60, "1 h", "1 h"],
    [61, "1 h 1 min", "1 h 1 min"],
    [23 * 60 + 59, "23 h 59 min", "23 h 59 min"],
    [24 * 60, "1 d", "1 d"],
    [1741, "1 d 5 h", "1 d 5 h"],
    [6 * 24 * 60 + 23 * 60, "6 d 23 h", "6 d 23 h"],
    // A duration has no date: past a week it keeps counting days.
    [7 * 24 * 60, "7 d", "7 d"],
    [9 * 24 * 60 + 60, "9 d 1 h", "9 d 1 h"],
  ])("%i min reads %s / %s", (minutes, es, en) => {
    expect(formatDuration(minutes, "es")).toBe(es);
    expect(formatDuration(minutes, "en")).toBe(en);
  });

  it("treats negative and unreadable lengths as under a minute", () => {
    expect(formatDuration(-3, "es")).toBe("menos de 1 min");
    expect(formatDuration(Number.NaN, "en")).toBe("under 1 min");
  });
});

describe("elapsedMinutes", () => {
  it("counts whole minutes and never goes negative", () => {
    expect(elapsedMinutes(before(59_000), NOW)).toBe(0);
    expect(elapsedMinutes(before(MIN), NOW)).toBe(1);
    expect(elapsedMinutes(before(1741 * MIN + 30_000), NOW)).toBe(1741);
    expect(elapsedMinutes(before(-MIN), NOW)).toBe(0);
    expect(elapsedMinutes("garbage", NOW)).toBe(0);
  });
});
