import type { createAdminClient } from "@/lib/supabase/admin";
import { CARD_COLUMNS, cardState, programOf } from "@/lib/loyalty/server";
import { standing } from "@/lib/loyalty/standing";
import { nextStep } from "@/lib/loyalty/next-step";
import type { TicketLoyalty } from "@/lib/ticket-pdf";

type Db = ReturnType<typeof createAdminClient>;
type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * The visit card a sale or its table's bill carries, as the ticket prints it:
 * the code's last four (a ticket identifies nobody), where the card stands
 * after this payment stamped it, and the next reward in the rewards screen's
 * own words. Null when no card was presented, or it cannot be read: a ticket
 * never shows a card on a guess.
 */
export async function ticketLoyalty(db: Db, restaurantId: string, orderIds: string[], t: T): Promise<TicketLoyalty | null> {
  if (!orderIds.length) return null;
  const { data: orders, error } = await db.from("orders").select("loyalty_card_id, session_id")
    .eq("restaurant_id", restaurantId).in("id", orderIds);
  if (error || !orders?.length) return null;
  let cardId = orders.find(o => o.loyalty_card_id)?.loyalty_card_id as string | undefined;
  if (!cardId) {
    const sessions = [...new Set(orders.map(o => o.session_id).filter(Boolean))] as string[];
    if (sessions.length) {
      const { data } = await db.from("table_sessions").select("loyalty_card_id")
        .eq("restaurant_id", restaurantId).in("id", sessions).not("loyalty_card_id", "is", null).limit(1);
      cardId = data?.[0]?.loyalty_card_id as string | undefined;
    }
  }
  if (!cardId) return null;
  const { data: card } = await db.from("loyalty_cards").select(`${CARD_COLUMNS}, code`)
    .eq("restaurant_id", restaurantId).eq("id", cardId).maybeSingle();
  if (!card) return null;
  const program = await programOf(restaurantId);
  const state = await cardState(card, program?.reward ?? "");
  if (!state) return null;
  const now = standing(state.progress, state.ladder, state.done);
  const step = nextStep(now);
  return { last4: String(card.code).slice(-4), progress: now.visits, goal: now.goal, message: t(step.key, step.vars) };
}
