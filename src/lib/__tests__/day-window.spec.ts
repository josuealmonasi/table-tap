import { describe, expect, it } from "vitest";
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

  it("keeps days whole across a daylight-saving change", () => {
    // Tijuana springs forward on 5 April 2026: that day is 23 hours long, and
    // a fixed 24-hour step would land an hour into the wrong day.
    const before = startOfLocalDay(new Date("2026-04-04T12:00:00Z"), TIJUANA);
    const after = startOfNextLocalDay(before, TIJUANA);
    expect(localDayKey(before, TIJUANA)).toBe("2026-04-04");
    expect(localDayKey(after, TIJUANA)).toBe("2026-04-05");
    expect(localHour(after, TIJUANA)).toBe(0);
  });

  it("counts back whole days for a 7-day window", () => {
    const start = subtractLocalDays(new Date("2026-08-18T20:00:00Z"), 6, MX);
    expect(localDayKey(start, MX)).toBe("2026-08-12");
    expect(localHour(start, MX)).toBe(0);
  });

  it("counts back whole days across a daylight-saving change too", () => {
    const start = subtractLocalDays(new Date("2026-04-08T12:00:00Z"), 6, TIJUANA);
    expect(localDayKey(start, TIJUANA)).toBe("2026-04-02");
    expect(localHour(start, TIJUANA)).toBe(0);
  });

  it("finds the first of the month on the restaurant's calendar", () => {
    const start = startOfLocalMonth(new Date("2026-08-19T02:00:00Z"), MX);
    // Still 18 August locally, so the month started on the 1st.
    expect(localDayKey(start, MX)).toBe("2026-08-01");
    expect(start.toISOString()).toBe("2026-08-01T06:00:00.000Z");
  });
});
