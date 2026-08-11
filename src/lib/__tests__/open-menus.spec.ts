import { describe, expect, it } from "vitest";
import { openMenuIds, type MenuOpenState } from "@/lib/open-menus";
import type { MenuSchedule } from "@/lib/menu-schedule";

const TZ = "America/Mexico_City";
const at = (iso: string) => new Date(`${iso}-06:00`);
const lunch: MenuSchedule = {
  enabled: true,
  rules: [{ days: [1, 2, 3, 4, 5], allDay: false, start: "09:00", end: "17:00" }],
};

const menu = (over: Partial<MenuOpenState> = {}): MenuOpenState => ({
  id: "m1",
  active: true,
  schedule: null,
  ...over,
});

describe("openMenuIds", () => {
  it("opens a manual menu at any hour", () => {
    const r = openMenuIds([menu()], TZ, at("2026-08-10T20:00"));
    expect(r.ids).toEqual(["m1"]);
    expect(r.closedNow).toBe(false);
  });

  it("closes the restaurant when its only menu is outside its hours", () => {
    // The user's case: 09:00-17:00, and it's 20:00.
    const r = openMenuIds([menu({ schedule: lunch })], TZ, at("2026-08-10T20:00"));
    expect(r.ids).toEqual([]);
    expect(r.closedNow).toBe(true);
  });

  it("stays open inside the window", () => {
    const r = openMenuIds([menu({ schedule: lunch })], TZ, at("2026-08-10T12:00"));
    expect(r.ids).toEqual(["m1"]);
    expect(r.closedNow).toBe(false);
  });

  it("is not closed when another menu is still serving", () => {
    const r = openMenuIds(
      [menu({ schedule: lunch }), menu({ id: "m2" })],
      TZ,
      at("2026-08-10T20:00"),
    );
    expect(r.ids).toEqual(["m2"]);
    expect(r.closedNow).toBe(false);
  });

  it("counts a switched-off menu as closed even inside its hours", () => {
    const r = openMenuIds(
      [menu({ active: false, schedule: lunch })],
      TZ,
      at("2026-08-10T12:00"),
    );
    expect(r.closedNow).toBe(true);
  });

  it("does not claim 'closed' for a restaurant with no menus at all", () => {
    const r = openMenuIds([], TZ, at("2026-08-10T12:00"));
    expect(r.ids).toEqual([]);
    expect(r.closedNow).toBe(false);
  });
});
