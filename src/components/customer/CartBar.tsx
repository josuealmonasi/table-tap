"use client";

import { formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n/context";

/** The sticky "View Cart" button shown at the bottom of the menu once items are added. */
export default function CartBar({
  count,
  total,
  currency,
  onClick,
}: {
  count: number;
  total: number;
  currency: string;
  onClick: () => void;
}) {
  const t = useT();
  if (count === 0) return null;

  return (
    <div className="tt-fab-wrap">
      <button className="tt-fab" onClick={onClick}>
        <span className="tt-fab-count">{count}</span>
        <span>{t("cart.viewCart")}</span>
        <span>{formatMoney(total, currency)}</span>
      </button>
    </div>
  );
}
