/**
 * What a new restaurant still has to do before it can take orders and money,
 * worked out from what it has done — never from a box somebody ticked.
 *
 * Asked for by a café switching over: "help configure printers and payments".
 * Two of the steps are optional: a café with no printer, or run by its owner
 * alone, is not unfinished.
 *
 * Pure.
 */

export type SetupKey = "menu" | "tables" | "payments" | "printer" | "team";

export interface SetupStep {
  key: SetupKey;
  done: boolean;
  optional: boolean;
  href: string;
}

/** What the server read about the restaurant. */
export interface SetupFacts {
  hasDishes: boolean;
  hasTables: boolean;
  takesCards: boolean;
  prints: boolean;
  hasTeam: boolean;
}

export function setupSteps(facts: SetupFacts): SetupStep[] {
  return [
    { key: "menu", done: facts.hasDishes, optional: false, href: "#menus" },
    { key: "tables", done: facts.hasTables, optional: false, href: "/dashboard/tables" },
    { key: "payments", done: facts.takesCards, optional: false, href: "/dashboard/settings#pagos" },
    { key: "printer", done: facts.prints, optional: true, href: "/dashboard/settings#impresion" },
    { key: "team", done: facts.hasTeam, optional: true, href: "/dashboard/staff" },
  ];
}

/** Whether there is anything left worth showing the checklist for. */
export const setupLeft = (steps: SetupStep[]): boolean => steps.some(s => !s.done);
