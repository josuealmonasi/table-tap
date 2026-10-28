import { describe, expect, it } from "vitest";
import { clampTicketTimes, minutesWaiting, waitLevel } from "@/lib/ticket-wait";

describe("ticket waiting time", () => {
  const placed = "2026-10-27T20:00:00.000Z";
  const at = (min: number) => Date.parse(placed) + min * 60_000;
  it("counts whole minutes since the order was placed, never negative", () => {
    expect(minutesWaiting(placed, at(12.9))).toBe(12);
    expect(minutesWaiting(placed, at(-3))).toBe(0);
    expect(minutesWaiting("not a date", at(5))).toBe(0);
  });
  it("turns amber at the first threshold and red at the second", () => {
    expect(waitLevel(9, 10, 20)).toBe("ok");
    expect(waitLevel(10, 10, 20)).toBe("warn");
    expect(waitLevel(20, 10, 20)).toBe("late");
  });
  it("stores thresholds the column accepts, with late always after warn", () => {
    expect(clampTicketTimes(10, 20)).toEqual({ warn: 10, late: 20 });
    expect(clampTicketTimes(25, 15)).toEqual({ warn: 25, late: 26 });
    expect(clampTicketTimes(0, 9999)).toEqual({ warn: 10, late: 240 });
    expect(clampTicketTimes("abc", undefined)).toEqual({ warn: 10, late: 20 });
    expect(clampTicketTimes(500, 500)).toEqual({ warn: 239, late: 240 });
  });
});
