import type { Modifier } from "@/lib/types";
import type { RecipeLine } from "./recipe-cost";

/** A removed choice must not turn a recipe line into an ingredient used by nobody. */
export function recipeChoicesOffered(lines: Pick<RecipeLine, "mod_label" | "mod_option">[], modifiers: Modifier[]): boolean {
  return lines.every(line => line.mod_label === null && line.mod_option === null ||
    modifiers.some(group => group.label === line.mod_label && group.options.includes(line.mod_option ?? "")));
}
