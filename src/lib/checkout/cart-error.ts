import { NextResponse } from "next/server";
import { messagesFor, translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { rejectionMessage } from "@/lib/cart-rejection";
import type { CartRejection } from "@/lib/verify-cart";
import type { StockShortfall } from "@/lib/stock";

/**
 * A translated cart error that keeps the machine-readable fields alongside it.
 *
 * The customer screen acts on `unavailableItemId` / `missingModifiers` to
 * highlight the offending line, so the message can't just be a bare string —
 * and it can't stay English either, which is what it was until now.
 */
export async function cartError(
  key: string,
  vars: Record<string, string | number>,
  status: number,
  extra: Record<string, unknown>,
): Promise<NextResponse> {
  const messages = messagesFor(await getLocale());
  return NextResponse.json(
    { error: translate(messages, key, vars), ...extra },
    { status },
  );
}

/** A cart `verifiedLines` refused, answered so the diner's cart can act on it. */
export async function refuseCart(r: CartRejection): Promise<NextResponse> {
  // Vanished extras are the one refusal the cart can act on by itself: it
  // drops those lines and asks again, so it gets the ids rather than a
  // sentence. The wording of the rest lives in `rejectionMessage`.
  if (r.kind === "removedExtras") {
    return NextResponse.json(
      { removedExtraIds: r.ids, removedExtraNames: r.names },
      { status: 409 },
    );
  }
  const { key, vars } = rejectionMessage(r);
  const extra =
    r.kind === "unavailable"
      ? { unavailableItemId: r.itemId }
      : r.kind === "missingModifiers"
        ? { missingModifiers: r.unanswered, unansweredItemId: r.itemId }
        : {};
  return cartError(key, vars, 400, extra);
}

/**
 * Stock ran out between the menu and the checkout.
 *
 * Names the first dish that fell short and says how many there really are. A
 * bare "unavailable" would send them back to a cart that looks fine.
 */
export async function refuseShortStock(short: StockShortfall[]): Promise<NextResponse> {
  const first = short[0];
  return cartError(
    first ? "apiErr.onlyLeft" : "apiErr.stockGone",
    { name: first?.name ?? "", count: first?.available ?? 0 },
    409,
    { shortStock: short.map(s => ({ itemId: s.itemId, available: s.available })) },
  );
}
