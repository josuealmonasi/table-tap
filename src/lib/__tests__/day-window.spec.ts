import { describe, expect, it, vi } from "vitest";
import { localToday } from "@/lib/loyalty/day";
import { localDay } from "@/lib/terminal";
import {
  localDayKey,
  localHour,
  startOfLocalDay,
  startOfLocalMonth,
  startOfNextLocalDay,
  subtractLocalDays,
} from "@/lib/day-window";

const MX = "America/Mexico_City"; // UTC-6, no daylight saving since 2022
const TIJUANA = "America/Tijuana"; // UTC-8/-7, still changes clocks

describe("the restaurant's own day", () => {
  it("starts at local midnight, not the server's", () => {
    // 02:00 UTC on the 19th is still the evening of the 18th in Mexico City.
    const start = startOfLocalDay(new Date("2026-08-19T02:00:00Z"), MX);
    expect(start.toISOString()).toBe("2026-08-18T06:00:00.000Z");
  });

  it("puts a late dinner in the day it was served, not the next one", () => {
    // The bug this exists to prevent: 8pm local is already "tomorrow" in UTC.
    const dinner = new Date("2026-08-19T02:30:00Z"); // 20:30 on the 18th
    expect(localDayKey(dinner, MX)).toBe("2026-08-18");
    expect(localHour(dinner, MX)).toBe(20);
  });

  it("reads midnight itself as hour zero", () => {
    expect(localHour(new Date("2026-08-19T06:00:00Z"), MX)).toBe(0);
  });

  it("moves to the next day exactly 24 hours on, where clocks don't change", () => {
    const next = startOfNextLocalDay(new Date("2026-08-18T18:00:00Z"), MX);
    expect(next.toISOString()).toBe("2026-08-19T06:00:00.000Z");
  });

  it("keeps the spring clock-change day whole at 23 hours", () => {
    const before = startOfLocalDay(new Date("2026-03-08T12:00:00Z"), TIJUANA);
    const after = startOfNextLocalDay(before, TIJUANA);
    expect(before.toISOString()).toBe("2026-03-08T08:00:00.000Z");
    expect(after.toISOString()).toBe("2026-03-09T07:00:00.000Z");
    expect(after.getTime() - before.getTime()).toBe(23 * 60 * 60 * 1000);
    expect(localHour(after, TIJUANA)).toBe(0);
  });

  it("keeps the autumn clock-change day whole at 25 hours", () => {
    const before = startOfLocalDay(new Date("2026-11-01T12:00:00Z"), TIJUANA);
    const after = startOfNextLocalDay(before, TIJUANA);
    expect(before.toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(after.toISOString()).toBe("2026-11-02T08:00:00.000Z");
    expect(after.getTime() - before.getTime()).toBe(25 * 60 * 60 * 1000);
    expect(localHour(after, TIJUANA)).toBe(0);
  });

  it("counts back whole days for a 7-day window", () => {
    const start = subtractLocalDays(new Date("2026-08-18T20:00:00Z"), 6, MX);
    expect(localDayKey(start, MX)).toBe("2026-08-12");
    expect(localHour(start, MX)).toBe(0);
  });

  it("counts back whole days across a daylight-saving change too", () => {
    const start = subtractLocalDays(new Date("2026-03-11T12:00:00Z"), 6, TIJUANA);
    expect(localDayKey(start, TIJUANA)).toBe("2026-03-05");
    expect(start.toISOString()).toBe("2026-03-05T08:00:00.000Z");
    expect(localHour(start, TIJUANA)).toBe(0);
  });

  it("finds the first of the month on the restaurant's calendar", () => {
    const start = startOfLocalMonth(new Date("2026-08-19T02:00:00Z"), MX);
    // Still 18 August locally, so the month started on the 1st.
    expect(localDayKey(start, MX)).toBe("2026-08-01");
    expect(start.toISOString()).toBe("2026-08-01T06:00:00.000Z");
  });
});

describe("the day used by reports, loyalty and terminal receipts", () => {
  it.each([
    ["2026-10-27T05:59:59.999Z", MX, "2026-10-26"],
    ["2026-10-27T06:00:00Z", MX, "2026-10-27"],
    ["2024-03-01T05:59:59Z", MX, "2024-02-29"],
    ["2027-01-01T05:59:59Z", MX, "2026-12-31"],
    ["2026-12-31T15:00:00Z", "Asia/Tokyo", "2027-01-01"],
    ["2026-10-27T10:00:00Z", "Pacific/Kiritimati", "2026-10-28"],
    ["2026-03-08T07:59:59Z", TIJUANA, "2026-03-07"],
    ["2026-03-08T08:00:00Z", TIJUANA, "2026-03-08"],
    ["2026-03-08T09:59:59Z", TIJUANA, "2026-03-08"],
    ["2026-03-08T10:00:00Z", TIJUANA, "2026-03-08"],
    ["2026-11-01T08:59:59Z", TIJUANA, "2026-11-01"],
    ["2026-11-01T09:00:00Z", TIJUANA, "2026-11-01"],
    ["2026-11-02T08:00:00Z", TIJUANA, "2026-11-02"],
  ])("dates %s in %s as %s", (iso, zone, expected) => {
    const date = new Date(iso);
    const instant = date.getTime();
    expect(localDayKey(date, zone)).toBe(expected);
    expect(localToday(zone, date)).toBe(expected);
    expect(localDay(iso, zone)).toBe(expected);
    expect(localDay(date, zone)).toBe(expected);
    expect(date.getTime()).toBe(instant);
  });

  it("keeps the configured fallback for a missing or empty loyalty zone", () => {
    const at = new Date("2026-10-27T05:30:00Z");
    expect(localToday(null, at)).toBe("2026-10-26");
    expect(localToday("", at)).toBe("2026-10-26");
    expect(localToday("UTC", at)).toBe("2026-10-27");
  });

  it("uses the current instant when loyalty receives no explicit date", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-27T05:59:59.999Z"));
      expect(localToday(null)).toBe("2026-10-26");
      vi.advanceTimersByTime(1);
      expect(localToday(null)).toBe("2026-10-27");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a receipt's explicit offset when converting its string date", () => {
    expect(localDay("2026-10-27T15:00:00+09:00", MX)).toBe("2026-10-27");
  });

  it("refuses invalid dates instead of assigning them a day", () => {
    const invalid = new Date("not-a-date");
    expect(() => localDayKey(invalid, MX)).toThrow(RangeError);
    expect(() => localToday(MX, invalid)).toThrow(RangeError);
    expect(() => localDay(invalid, MX)).toThrow(RangeError);
    expect(() => localDay("not-a-date", MX)).toThrow(RangeError);
  });

  it("refuses invalid zones instead of silently choosing a default", () => {
    const at = new Date("2026-10-27T05:30:00Z");
    expect(() => localDayKey(at, "Invalid/Zone")).toThrow(RangeError);
    expect(() => localToday("Invalid/Zone", at)).toThrow(RangeError);
    expect(() => localDay(at, "Invalid/Zone")).toThrow(RangeError);
  });
});
