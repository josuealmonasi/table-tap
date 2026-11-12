import { nextStep } from "@/lib/loyalty/next-step";
import type { ReceiptCard } from "@/lib/loyalty/attachment";
import type { ReceiptSource } from "@/lib/receipt-source";
import type { TicketLoyalty } from "@/lib/ticket-pdf";

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * The visit card on the 80 mm ticket, from the card the receipt source already
 * read — the sale's, its sitting's, or a split part's sitting — so the PDF and
 * the HTML receipt can never disagree about whether a card was presented.
 * The code's last four only (a ticket identifies nobody), where the card stands
 * after this payment stamped it, and the next reward in the rewards screen's
 * own words. Null when no card was presented.
 */
export function ticketLoyalty(source: Pick<ReceiptSource, "orders" | "payment">, t: T): TicketLoyalty | null {
  const card: ReceiptCard | null | undefined = source.payment?.loyalty ?? source.orders.find(o => o.loyalty)?.loyalty;
  if (!card) return null;
  const step = nextStep(card.standing);
  return { last4: card.suffix.slice(-4), progress: card.standing.visits, goal: card.standing.goal, message: t(step.key, step.vars) };
}
