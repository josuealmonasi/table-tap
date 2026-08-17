"use client";

import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { itemSalePrice } from "@/lib/pricing";
import DishImage from "./DishImage";
import type { MenuItem } from "@/lib/types";

/**
 * "Anything else?" — asked once, where a waiter would ask it.
 *
 * It sits above the totals rather than interrupting the order button: a diner
 * who is done scrolls past it, and one who wants a drink taps it and gets the
 * ordinary dish screen, with its options and its notes, rather than a
 * one-tap add that skips the choices the kitchen needs.
 */
export default function SuggestionStrip({
  items,
  currency,
  onPick,
}: {
  items: MenuItem[];
  currency: string;
  onPick: (item: MenuItem) => void;
}) {
  const t = useT();
  if (items.length === 0) return null;

  return (
    <section className="tt-suggest" aria-label={t("cart.suggestTitle")}>
      <h3 className="tt-suggest-head">{t("cart.suggestTitle")}</h3>
      <div className="tt-suggest-row">
        {items.map(item => (
          <button
            key={item.id}
            type="button"
            className="tt-suggest-card"
            onClick={() => onPick(item)}
          >
            <span className="tt-suggest-thumb">
              <DishImage url={item.image_url} emoji={item.emoji} name={item.name} />
            </span>
            <span className="tt-suggest-name">{item.name}</span>
            <span className="tt-suggest-price">
              {formatMoney(itemSalePrice(item.price, item.discount_pct), currency)}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
