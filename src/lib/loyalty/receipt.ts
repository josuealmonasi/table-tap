import { wrap } from "@/lib/ticket";
import type { ReceiptCard } from "./attachment";

export interface ReceiptLoyalty {
  loyalty?: ReceiptCard | null;
  loyaltyPending?: { suffix: string } | null;
}

/** Progress is read after payment, never optimistically incremented by a till. */
export function loyaltyReceiptLines(
  sources: ReceiptLoyalty[],
  t: (key: string, vars?: Record<string, string | number>) => string,
): string[] {
  const seen = new Set<string>();
  return sources.flatMap(source => {
    const card = source.loyalty;
    const suffix = (card?.suffix ?? source.loyaltyPending?.suffix)?.slice(-4);
    const identity = card?.cardId ?? suffix;
    if (!suffix || !identity || seen.has(identity)) return [];
    seen.add(identity);
    if (!card) return wrap(t("loyaltyAttach.pending", { code: suffix }));
    const s = card.standing;
    return wrap(t(s.ready ? "loyaltyAttach.earned" : "loyaltyAttach.progress", {
      code: suffix, progress: s.visits, goal: s.goal, n: s.toGo, reward: s.next?.reward ?? "",
    }));
  });
}
