import type { PlanLimits } from "@/lib/plan";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * A tier's one-line description. The table count is read from the plan row,
 * never written into the copy: a limit changed in the catalog (Servicio went
 * from 25 tables to 15) would otherwise leave the card promising the old one.
 */
export function planDescription(t: Translate, limits: Pick<PlanLimits, "plan" | "max_tables">): string {
  return t(`plan.desc.${limits.plan}`, { tables: limits.max_tables ?? "" });
}
