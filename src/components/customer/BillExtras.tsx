"use client";

import type { AppliedCoupon } from "@/lib/pricing";
import CouponBox from "./CouponBox";
import TipPicker from "./TipPicker";

interface BillExtrasProps {
  restaurantId: string;
  currency: string;
  /** A code can be used here: none of the orders already carries one. */
  couponOffered: boolean;
  /** What a code's minimum spend is judged against: the food being paid for. */
  food: number;
  coupon: AppliedCoupon | null;
  onCoupon: (coupon: AppliedCoupon | null) => void;
  tipPct: number;
  tipCustom: number | null;
  /** The most a tip can be: what is being paid before it. */
  maxTip: number;
  onTipPct: (pct: number) => void;
  onTipCustom: (amount: number | null) => void;
}

/**
 * The code and the tip, for a diner settling the bill themselves by card.
 *
 * Neither does anything on a bill somebody is collecting in person: both are
 * theirs to take at the table, on the same screen they take the money on. A
 * field that changes no number is a promise the system will not keep — and
 * with no card behind the bill at all, neither of them changes anything. The
 * sheet only shows this when they do.
 */
export default function BillExtras({
  restaurantId,
  currency,
  couponOffered,
  food,
  coupon,
  onCoupon,
  tipPct,
  tipCustom,
  maxTip,
  onTipPct,
  onTipCustom,
}: BillExtrasProps) {
  return (
    <>
      {couponOffered && (
        <div className="tt-coupon-row">
          <CouponBox
            restaurantId={restaurantId}
            subtotal={food}
            applied={coupon}
            onApply={onCoupon}
            onRemove={() => onCoupon(null)}
          />
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <TipPicker
          currency={currency}
          tipPct={tipPct}
          tipCustom={tipCustom}
          maxTip={maxTip}
          onPresetTip={onTipPct}
          onCustomTip={onTipCustom}
        />
      </div>
    </>
  );
}
