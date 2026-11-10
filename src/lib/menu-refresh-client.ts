/**
 * Tells the server the menu editor just saved, so diners see it now.
 *
 * The editor writes straight to the database from the browser, which clears
 * no server cache; without this a price or a sold-out switch reached diners
 * up to 30 seconds later (`PUBLIC_MENU_TTL`). Never awaited and never
 * reported: the save itself already succeeded, and if this request is lost —
 * the tab closed in the same instant — the menu still catches up within the
 * 30 seconds. Where `fetch` does not exist (unit tests), it does nothing.
 */
export function refreshDinerMenu(): void {
  if (typeof fetch !== "function") return;
  void fetch("/api/menu/refresh", { method: "POST" }).catch(() => {});
}
