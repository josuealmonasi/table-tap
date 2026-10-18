/**
 * What taking the money costs, as a share of what was taken.
 *
 * Every product is paid for the same few ways, so its fee is the restaurant's
 * own mix applied to its price: the period's fees over the period's takings.
 * Cash costs nothing. A card through TableTap pays Stripe's Mexican rate —
 * 3.6% plus MX$3 a charge, with IVA on the fee — and TableTap's per-order fee,
 * which the order records. A card on the restaurant's own terminal pays
 * whatever the owner signed for, which they tell us.
 *
 * Pure.
 */

export const STRIPE_PCT = 3.6;
export const STRIPE_FIXED = 3;
/** IVA charged on top of Stripe's fee. */
export const FEE_IVA_PCT = 16;

export interface FeePayment {
  amount: number;
  method: "card" | "cash";
  /** Set when Stripe took it; a card with none was the restaurant's own terminal. */
  stripe_payment_intent: string | null;
}

/** What one payment cost to take. */
export function paymentFee(p: FeePayment, terminalPct: number): number {
  const amount = Number(p.amount);
  if (p.method === "cash") return 0;
  if (p.stripe_payment_intent) return (amount * (STRIPE_PCT / 100) + STRIPE_FIXED) * (1 + FEE_IVA_PCT / 100);
  return amount * (terminalPct / 100);
}

export interface FeeRate {
  /** Fees over takings, 0–1. */
  rate: number;
  takings: number;
  fees: number;
  /** How the takings arrived, for the sentence that explains the rate. */
  cash: number;
  online: number;
  terminal: number;
}

/**
 * The period's fees as a share of its takings.
 *
 * @param platformFees TableTap's per-order fees over the same period.
 */
export function feeRate(payments: FeePayment[], platformFees: number, terminalPct: number): FeeRate {
  let takings = 0;
  let fees = platformFees;
  let cash = 0;
  let online = 0;
  let terminal = 0;
  const charged = new Set<string>();
  for (const p of payments) {
    const amount = Number(p.amount);
    takings += amount;
    fees += paymentFee(p, terminalPct);
    if (p.stripe_payment_intent && charged.has(p.stripe_payment_intent)) fees -= STRIPE_FIXED * (1 + FEE_IVA_PCT / 100);
    if (p.stripe_payment_intent) charged.add(p.stripe_payment_intent);
    if (p.method === "cash") cash += amount;
    else if (p.stripe_payment_intent) online += amount;
    else terminal += amount;
  }
  return { rate: takings > 0 ? fees / takings : 0, takings, fees, cash, online, terminal };
}
