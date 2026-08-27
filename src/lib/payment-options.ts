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
  /** The "let tables pay at the end" switch. */
  allowPayLater: boolean;
  /** The "pay at the counter" switch, which belongs to the general QR. */
  allowCounterPayment: boolean;
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
    payLater: ctx.atTable && ctx.allowPayLater,
    // And the till only makes sense where no table is holding the order.
    payCounter: !ctx.atTable && ctx.allowCounterPayment,
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
  if (!ctx.allowPayLater && !ctx.allowCounterPayment) return "dash.noPaymentAtAll";
  return "dash.noCardsConnected";
}
