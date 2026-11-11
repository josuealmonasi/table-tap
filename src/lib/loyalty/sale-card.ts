import { apiError } from "@/lib/api-error";
import { getPlan } from "@/lib/plan-server";
import { loyaltyOn } from "./server";
import { normalizeCode } from "./code";
import { cardForSale } from "./attachment-server";

/** The transaction gets a server-resolved card id, never a caller's row id. */
export async function saleCard(restaurantId: string, raw: unknown, collected = false) {
  if (raw === undefined || raw === null) return { cardId: null };
  const code = typeof raw === "string" ? normalizeCode(raw) : null;
  // Replaying collected cash must survive a card being deleted or switched off.
  if (collected) return { cardId: code ? await cardForSale(restaurantId, code) : null };
  if (!code) return { error: await apiError("rewards.invalid", 400) };
  const plan = await getPlan(restaurantId);
  if (!(await loyaltyOn(restaurantId, plan?.limits ?? null))) return { error: await apiError("loyaltyAttach.off", 409) };
  const cardId = await cardForSale(restaurantId, code);
  return cardId ? { cardId } : { error: await apiError("loyaltyAttach.unknown", 404) };
}
