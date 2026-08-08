import { describe, expect, it } from "vitest";
import {
  cleanSchedule,
  hasLiveSchedule,
  isMenuOpen,
  localNow,
  ruleCoversAt,
  scheduleError,
  summarizeSchedule,
  toMinutes,
  type MenuSchedule,
  type Weekday,
} from "@/lib/menu-schedule";

const TZ = "America/Mexico_City";
const weekdays: Weekday[] = [1, 2, 3, 4, 5];
const weekend: Weekday[] = [0, 6];

/** A Mexico City wall-clock time, as the instant it refers to. */
const at = (iso: string) => new Date(`${iso}-06:00`);

const sched = (rules: MenuSchedule["rules"], enabled = true): MenuSchedule => ({
  enabled,
  rules,
});

describe("toMinutes", () => {
  it("parses a 24-hour time", () => {
    expect(toMinutes("00:00")).toBe(0);
    expect(toMinutes("17:30")).toBe(1050);
  });

  it("rejects anything that isn't HH:MM", () => {
    for (const bad of ["", "24:00", "9:00", "12:60", "noon", undefined]) {
      expect(toMinutes(bad as string)).toBeNull();
    }
  });
});

describe("localNow", () => {
  it("reads the weekday and time in the restaurant's zone, not the server's", () => {
    // 2026-08-10 is a Monday. 01:00 UTC is still Sunday evening in Mexico City.
    expect(localNow(new Date("2026-08-10T01:00:00Z"), TZ)).toEqual({
      day: 0,
      minutes: 19 * 60,
    });
  });
});

describe("the user's four examples", () => {
  const lunch = sched([{ days: weekdays, allDay: false, start: "12:00", end: "17:00" }]);
  const dinner = sched([{ days: weekdays, allDay: false, start: "17:00", end: "20:00" }]);
  const weekendAllDay = sched([{ days: weekend, allDay: true }]);
  const weekendTea = sched([
    { days: weekend, allDay: false, start: "15:00", end: "18:00" },
  ]);

  it("menu 1 — Mon-Fri 12:00-17:00", () => {
    expect(isMenuOpen(true, lunch, at("2026-08-10T12:00"), TZ)).toBe(true);
    expect(isMenuOpen(true, lunch, at("2026-08-10T16:59"), TZ)).toBe(true);
    expect(isMenuOpen(true, lunch, at("2026-08-10T17:00"), TZ)).toBe(false);
    expect(isMenuOpen(true, lunch, at("2026-08-10T11:59"), TZ)).toBe(false);
    expect(isMenuOpen(true, lunch, at("2026-08-08T13:00"), TZ)).toBe(false); // Saturday
  });

  it("menu 2 — Mon-Fri 17:00-20:00 picks up exactly where lunch stops", () => {
    expect(isMenuOpen(true, dinner, at("2026-08-10T17:00"), TZ)).toBe(true);
    expect(isMenuOpen(true, dinner, at("2026-08-10T16:59"), TZ)).toBe(false);
    expect(isMenuOpen(true, dinner, at("2026-08-10T20:00"), TZ)).toBe(false);
  });

  it("menu 3 — Saturday and Sunday, all day", () => {
    expect(isMenuOpen(true, weekendAllDay, at("2026-08-08T00:00"), TZ)).toBe(true);
    expect(isMenuOpen(true, weekendAllDay, at("2026-08-09T23:59"), TZ)).toBe(true);
    expect(isMenuOpen(true, weekendAllDay, at("2026-08-10T09:00"), TZ)).toBe(false);
  });

  it("menu 4 — weekend 15:00-18:00, overlapping menu 3", () => {
    expect(isMenuOpen(true, weekendTea, at("2026-08-08T15:30"), TZ)).toBe(true);
    expect(isMenuOpen(true, weekendTea, at("2026-08-08T14:59"), TZ)).toBe(false);
  });

  it("lets several menus be open at once", () => {
    const when = at("2026-08-08T16:00"); // Saturday afternoon
    expect(isMenuOpen(true, weekendAllDay, when, TZ)).toBe(true);
    expect(isMenuOpen(true, weekendTea, when, TZ)).toBe(true);
    expect(isMenuOpen(true, null, when, TZ)).toBe(true); // a manual menu too
  });
});

describe("active outranks the schedule", () => {
  const lunch = sched([{ days: weekdays, allDay: false, start: "12:00", end: "17:00" }]);

  it("hides a switched-off menu even inside its hours", () => {
    expect(isMenuOpen(false, lunch, at("2026-08-10T13:00"), TZ)).toBe(false);
  });

  it("lets the schedule decide again once it's switched back on", () => {
    expect(isMenuOpen(true, lunch, at("2026-08-10T13:00"), TZ)).toBe(true);
  });
});

describe("no schedule means manual, as before", () => {
  it("shows an active menu with no schedule at any time", () => {
    expect(isMenuOpen(true, null, at("2026-08-10T03:00"), TZ)).toBe(true);
    expect(isMenuOpen(true, undefined, at("2026-08-10T03:00"), TZ)).toBe(true);
  });

  it("treats a paused schedule as no schedule", () => {
    const paused = sched(
      [{ days: [1], allDay: false, start: "12:00", end: "13:00" }],
      false,
    );
    expect(hasLiveSchedule(paused)).toBe(false);
    expect(isMenuOpen(true, paused, at("2026-08-10T22:00"), TZ)).toBe(true);
  });

  it("treats a schedule with no usable rules as no schedule", () => {
    expect(
      isMenuOpen(true, sched([{ days: [], allDay: true }]), at("2026-08-10T03:00"), TZ),
    ).toBe(true);
  });
});

describe("windows that cross midnight", () => {
  const lateBar = { days: [5] as Weekday[], allDay: false, start: "22:00", end: "02:00" };

  it("stays open after midnight into the next day", () => {
    expect(ruleCoversAt(lateBar, 5, 23 * 60)).toBe(true); // Friday 23:00
    expect(ruleCoversAt(lateBar, 6, 1 * 60)).toBe(true); // Saturday 01:00
    expect(ruleCoversAt(lateBar, 6, 3 * 60)).toBe(false); // Saturday 03:00
    expect(ruleCoversAt(lateBar, 5, 21 * 60)).toBe(false); // Friday 21:00
  });
});

describe("cleanSchedule", () => {
  it("drops rules that could never match and dedupes days", () => {
    const out = cleanSchedule(
      sched([
        { days: [1, 1, 2], allDay: false, start: "10:00", end: "11:00" },
        { days: [], allDay: true },
        { days: [3], allDay: false, start: "bad", end: "11:00" },
      ]),
    );
    expect(out.rules).toEqual([
      { days: [1, 2], allDay: false, start: "10:00", end: "11:00" },
    ]);
  });

  it("clears the times on an all-day rule", () => {
    const out = cleanSchedule(
      sched([{ days: [0], allDay: true, start: "10:00", end: "11:00" }]),
    );
    expect(out.rules[0]).toEqual({
      days: [0],
      allDay: true,
      start: undefined,
      end: undefined,
    });
  });
});

describe("scheduleError", () => {
  it("rejects an empty schedule", () => {
    expect(scheduleError(sched([]))).toBe("apiErr.schedNoRules");
  });

  it("rejects a rule with no days", () => {
    expect(scheduleError(sched([{ days: [], allDay: true }]))).toBe("apiErr.schedNoDays");
  });

  it("rejects an unparseable time", () => {
    expect(
      scheduleError(sched([{ days: [1], allDay: false, start: "9am", end: "17:00" }])),
    ).toBe("apiErr.schedBadTime");
  });

  it("rejects a zero-length window", () => {
    expect(
      scheduleError(sched([{ days: [1], allDay: false, start: "12:00", end: "12:00" }])),
    ).toBe("apiErr.schedSameTime");
  });

  it("accepts the user's examples", () => {
    expect(
      scheduleError(
        sched([{ days: weekdays, allDay: false, start: "12:00", end: "17:00" }]),
      ),
    ).toBeNull();
    expect(scheduleError(sched([{ days: weekend, allDay: true }]))).toBeNull();
  });
});

describe("summarizeSchedule", () => {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const sum = (rules: MenuSchedule["rules"]) =>
    summarizeSchedule({ enabled: true, rules }, DAYS, "all day");

  it("collapses a consecutive run into a range", () => {
    expect(
      sum([{ days: [1, 2, 3, 4, 5], allDay: false, start: "12:00", end: "17:00" }]),
    ).toEqual(["Mon–Fri 12:00–17:00"]);
  });

  it("lists two days rather than ranging them", () => {
    expect(sum([{ days: [0, 6], allDay: true }])).toEqual(["Sun, Sat all day"]);
  });

  it("gives each rule its own line", () => {
    expect(
      sum([
        { days: [1, 2, 3, 4, 5], allDay: false, start: "12:00", end: "17:00" },
        { days: [6], allDay: true },
      ]),
    ).toEqual(["Mon–Fri 12:00–17:00", "Sat all day"]);
  });
});
