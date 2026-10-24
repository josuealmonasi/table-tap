import { DRAWER_ERA } from "./money-drawer-values.mjs";

/** This deliberately unsigned legacy example must predate signed manifests. */
export function legacyTerminalTimes(now = Date.now()) {
  const hours = 3600000;
  const sale = Math.min(now - 72 * hours, Date.parse(DRAWER_ERA) - 30 * hours - 1);
  return {
    saleAt: new Date(sale).toISOString(),
    depositAt: new Date(sale + 30 * hours).toISOString(),
  };
}
