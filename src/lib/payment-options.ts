/**
 * Which ways of paying a diner is actually offered, and why the rest are missing.
 *
 * Pure and separate because two sides consult it and have to agree: the cart,
 * which paints the buttons and the line beneath them, and Settings, which tells
 * the owner what their customer is seeing. When each decided for itself, the
 * cart ended up promising "pay now by card" underneath a screen that had no
 * card button on it at all.
 */

export interface PaymentContext {
  /** A Stripe account is connected and cleared to take charges. */
  cardsEnabled: boolean;
  /**
   * The "pay at the end / at the counter" switch: may the food leave before it
   * is paid for? One switch, because it is one decision — what changes with the
   * QR is only who holds the order until someone pays, and the restaurant does
   * not get to choose that. At a table it is the table; on the general QR,
   * where there is no table to come back to, it is the till.
   *
   * It was two switches, and they disagreed: a restaurant with "let tables pay
   * at the end" on still showed the general QR a cart with no way out of it.
   */
  allowDeferred: boolean;
  /** They scanned a table's QR, or the restaurant's general one. */
  atTable: boolean;
  /** The restaurant's "taking orders" switch. Off stops every route in. */
  acceptingOrders: boolean;
}

export interface PaymentOptions {
  /** Pay by card right now. */
  payNow: boolean;
  /** Order and leave the bill open. Table only: with no table there is nobody to bill. */
  payLater: boolean;
  /** Order and pay at the till. No-table only: at a table the bill holds it. */
  payCounter: boolean;
}

export function paymentOptions(ctx: PaymentContext): PaymentOptions {
  // Paused beats everything: with orders off, checkout answers 409 whichever
  // way they try to pay, so offering any of them is offering a refusal.
  if (!ctx.acceptingOrders) return { payNow: false, payLater: false, payCounter: false };
  return {
    payNow: ctx.cardsEnabled,
    // Leaving a bill open needs a table to leave it against.
    payLater: ctx.atTable && ctx.allowDeferred,
    // And the till only makes sense where no table is holding the order.
    payCounter: !ctx.atTable && ctx.allowDeferred,
  };
}

/** Any way left to order? If not, the cart is a dead end. */
export function canOrder(options: PaymentOptions): boolean {
  return options.payNow || options.payLater || options.payCounter;
}

/**
 * What to say under the buttons — naming only what is really there.
 *
 * A translation key rather than a sentence: the caller has it translated, and
 * what is decided here is which one applies, which is the part that was wrong.
 */
export function paymentHintKey(options: PaymentOptions, acceptingOrders = true): string {
  const { payNow, payLater, payCounter } = options;
  // Why there is no button matters. "This restaurant does not take cards" and
  // "the kitchen has stopped for now" send the diner to do different things,
  // and the cart used to repeat "order now and pay at the end" under a button
  // that could not be pressed.
  if (!acceptingOrders) return "menu.closed";
  if (!canOrder(options)) return "cart.noCardYet";
  // Both together: the case the restaurant wants, and the only one where card
  // and open bill can be promised on the same line.
  if (payNow && payLater) return "cart.payNowHint";
  if (payNow && payCounter) return "cart.counterHint";
  // Card only: it is charged here and there is nothing to leave open.
  if (payNow) return "cart.securedBy";
  // With no card connected, promising one would be a lie. Say what happens.
  if (payLater) return "cart.payLaterOnlyHint";
  return "cart.counterOnlyHint";
}

/**
 * What the owner needs to know about their own configuration.
 *
 * `null` when there is nothing to warn about. When there is, it is because a
 * switch they turned on is not doing what its label promises.
 */
export function ownerWarningKey(ctx: PaymentContext): string | null {
  if (ctx.cardsEnabled) return null;
  // Without Stripe there is no online payment on any screen. What changes is how
  // bad that is, and that depends on what is left switched on.
  if (!ctx.allowDeferred) return "dash.noPaymentAtAll";
  return "dash.noCardsConnected";
}

/**
 * The same question for a bill that already exists.
 *
 * The cart asks how to pay for food about to be cooked; this asks how to pay
 * for food already eaten, and the answer is not the same shape. There is no
 * "order and leave it open" here — the bill IS the open one — but there are
 * two things the cart never has: dividing it between phones, and calling
 * somebody over to take it in person.
 *
 * Separate from `paymentOptions` rather than folded into it because every
 * field would have been wrong for one of the two callers, and a flag nobody
 * reads is how the two screens drift apart again.
 */
export interface BillContext {
  /** A Stripe account is connected and cleared to take charges. */
  cardsEnabled: boolean;
  /** A waiter opened this bill and is collecting it in person. */
  staffBill: boolean;
  /** The owner's switch: may a table divide its own bill? Default on. */
  splitAllowed?: boolean;
}

export interface BillActions {
  /** Settle it by card, here, now. */
  payOnline: boolean;
  /**
   * Divide it evenly between the people who ordered.
   *
   * Not the same question as paying by card. With Stripe connected each share
   * is charged to its own phone; without it the shares are a division the
   * table shows the waiter, who collects each one on the calculator — which is
   * most of what a table actually does with a bill. What it always needs is
   * the owner's switch, and somebody to divide it with.
   */
  split: boolean;
  /** A tip and a coupon, which only ever change what a card is charged. */
  extras: boolean;
  /** Call somebody over to take cash or run their own terminal. Always there. */
  callWaiter: boolean;
}

/**
 * A bill screen with no card behind it is the bug from Mesa 10: the diner was
 * offered "pay now", the route answered 409 because the restaurant has no
 * Stripe account, and the screen told them it was a network problem and to try
 * again. They divided the bill twelve ways first — a division that could not
 * have been paid either, because a share is charged through the same route.
 *
 * So all three go together. What survives is calling the waiter, which needs
 * nothing but a floor.
 */
export function billActions(ctx: BillContext): BillActions {
  // A waiter standing at the table with a running balance collects the whole
  // bill: a card charged here at the same moment is a table paying twice. That
  // covers dividing it too — two people collecting one bill through different
  // doors is the same mistake either way.
  const byCard = ctx.cardsEnabled && !ctx.staffBill;
  return {
    payOnline: byCard,
    // Dividing it needs the owner's switch, not a card reader.
    split: ctx.splitAllowed !== false && !ctx.staffBill,
    extras: byCard,
    callWaiter: true,
  };
}

/**
 * What to say where the card button would have been — `null` when it is there.
 *
 * Saying nothing is what made the first version of this a silent dead end: the
 * button simply was not drawn, and the diner was left looking for it.
 */
export function billHintKey(ctx: BillContext): string | null {
  if (billActions(ctx).payOnline) return null;
  return ctx.staffBill ? "bill.waiterSettles" : "bill.cashOnly";
}
