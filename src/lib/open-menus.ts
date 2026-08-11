import { isMenuOpen, type MenuSchedule } from "@/lib/menu-schedule";

/** The three columns the decision needs from a menu row. */
export interface MenuOpenState {
  id: string;
  active: boolean;
  schedule: MenuSchedule | null;
}

export interface OpenMenus {
  /** Menus a customer may order from right now. */
  ids: string[];
  /** True when the restaurant has menus but none of them is open. */
  closedNow: boolean;
}

export const DEFAULT_TIME_ZONE = "America/Mexico_City";

/**
 * Which menus customers may order from at this instant.
 *
 * Shared by the page that renders the menu and the route that takes the money,
 * for the same reason `priceCart` is shared: if the two disagree, a diner can
 * be shown one thing and charged for another. Here the failure would be
 * ordering from a menu that closed while the page sat open.
 *
 * Pure so it can be tested without a database — callers fetch the rows.
 *
 * `closedNow` separates "this restaurant has no menus at all" from "the
 * kitchen isn't serving right now"; only the second deserves an explanation.
 */
export function openMenuIds(
  menus: MenuOpenState[],
  timeZone: string,
  at: Date = new Date(),
): OpenMenus {
  const ids = menus
    .filter(m => isMenuOpen(m.active, m.schedule, at, timeZone))
    .map(m => m.id);
  return { ids, closedNow: menus.length > 0 && ids.length === 0 };
}
