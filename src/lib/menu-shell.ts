import { createClient } from "@/lib/supabase/server";
import { getPlan } from "@/lib/plan-server";
import { loyaltyOn, programOf } from "@/lib/loyalty/server";
import { unwrap } from "@/lib/unwrap";

/**
 * Just enough to draw the shell: does this restaurant show a cover?
 *
 * One indexed row, asked before the menu itself, so the skeleton can reserve
 * the right height. Without it the skeleton has no way to know — Next gives
 * `loading.tsx` no params — and the page jumped by the height of the photo
 * when the data landed.
 */
export async function loadCoverState(
  restaurantId: string,
): Promise<{ exists: boolean; cover: boolean }> {
  const supabase = await createClient();
  const res = await supabase
    .from("restaurants")
    .select("id, cover_url, cover_enabled")
    .eq("id", restaurantId)
    .maybeSingle();
  const row = unwrap(res, "the restaurant") as
    | { cover_url: string | null; cover_enabled: boolean }
    | null;
  return { exists: Boolean(row), cover: Boolean(row?.cover_enabled && row?.cover_url) };
}

/**
 * The program a menu offers, or null: the plan has the card, it is switched
 * on, and it has a reward to promise. Asked the way the card route asks, so
 * the menu never offers a card the route would then refuse to make.
 */
export async function offeredProgram(restaurantId: string, limits: Parameters<typeof loyaltyOn>[1]) {
  if (!(await loyaltyOn(restaurantId, limits))) return null;
  const program = await programOf(restaurantId);
  return program?.active && program.reward ? program : null;
}

/**
 * Whether the menu will show its visit card row — asked before the menu
 * streams, so the skeleton holds the row's room instead of the list jumping
 * down 48px when it lands. The same question the menu asks, never a guess;
 * and a skeleton is not worth a failed page, so a fault answers "no row".
 */
export async function menuShowsLoyalty(restaurantId: string): Promise<boolean> {
  try {
    const plan = await getPlan(restaurantId);
    return (await offeredProgram(restaurantId, plan?.limits ?? null)) !== null;
  } catch {
    return false;
  }
}
