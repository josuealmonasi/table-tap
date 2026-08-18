/**
 * Which orders, if any, to offer a receipt for.
 *
 * Pure so the rule can be tested without a browser: the hook does the reading
 * and the storing, this decides. Three ways a payment finishes, and the answer
 * is the orders that payment covered — minus anything already asked about,
 * because the offer is made once and a refresh is not a second payment.
 */
export function receiptTargets({
  search,
  paidOrderId,
  settling,
  asked,
}: {
  /** `window.location.search` on the page Stripe returned to. */
  search: string;
  /** The order a single-order payment was for. */
  paidOrderId: string | null;
  /** Ids stashed by the bill sheet before it handed off to Stripe. */
  settling: string[];
  /** Already offered, this tab. */
  asked: string[];
}): string[] {
  const params = new URLSearchParams(search);
  const ids =
    params.get("paid") === "1"
      ? paidOrderId
        ? [paidOrderId]
        : []
      : params.get("settled") === "1"
        ? settling
        : [];
  return ids.filter(id => id && !asked.includes(id));
}
