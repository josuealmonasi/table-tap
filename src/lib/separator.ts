/**
 * The dot between two facts on one line: "Mesa 4 · Ana · 5 min".
 *
 * The space before the dot does not break, so a line can wrap after a dot but
 * never start with one. A plain " · " let "· llegaron MX$571.13" open a line on
 * a phone (owner's screenshot and the layout audit, 2026-11-10).
 * `separator.spec.ts` refuses a plain one on any screen.
 */
export const SEP = " · ";
