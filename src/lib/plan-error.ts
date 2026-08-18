/**
 * Turning a refused write into something an owner can act on.
 *
 * The plan ceilings are enforced by a database trigger, which has no idea what
 * language anyone reads — so it raises a parseable sentinel and the dashboard
 * says the sentence. Same shape as the activity log's field format, and for
 * the same reason: the Spanish lives with the rest of the Spanish.
 */

export type PlanLimitKind = "tables" | "menus" | "items" | "staff";

export interface PlanLimitHit {
  kind: PlanLimitKind;
  /** The plan they are on, e.g. "servicio" — a key under plan.name. */
  plan: string;
  max: number;
}

// Searched rather than anchored: Postgres wraps the message differently
// depending on which client surfaced it.
const SENTINEL = /tt_plan_limit (tables|menus|items|staff) ([a-z]+) (\d+)/;

/** The ceiling that refused this write, or null if it failed for another reason. */
export function parsePlanLimit(message: string | null | undefined): PlanLimitHit | null {
  if (!message) return null;
  const found = SENTINEL.exec(message);
  if (!found) return null;
  return {
    kind: found[1] as PlanLimitKind,
    plan: found[2],
    max: Number(found[3]),
  };
}

/**
 * The i18n key and substitutions for a refused write.
 *
 * A ceiling of zero is a different sentence, not a smaller number: "your Carta
 * plan includes 0 tables" is how a machine says it. The tier that would unlock
 * them is deliberately not named here — the client has no catalog to look it
 * up in, and the plan screen exists to answer that.
 */
export function planLimitText(hit: PlanLimitHit): {
  key: string;
  vars: { plan: string; max: number };
} {
  return {
    key: hit.max === 0 ? `plan.none.${hit.kind}` : `plan.limit.${hit.kind}`,
    vars: { plan: hit.plan, max: hit.max },
  };
}
