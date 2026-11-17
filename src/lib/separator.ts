/**
 * The dot between two facts on one line: "Mesa 4 · Ana · 5 min".
 *
 * Both spaces around the dot do not break, so a line can neither start nor end
 * with one (the Android-rendered layout gate caught "Pagó en efectivo ·" ending
 * a line). A plain " · " let "· llegaron MX$571.13" open a line on a phone (owner's screenshot and the layout audit, 2026-11-10).
 * `separator.spec.ts` refuses a plain one on any screen.
 */
export const SEP = " · ";
