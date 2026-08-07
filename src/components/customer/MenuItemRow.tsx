"use client";

import { formatMoney } from "@/lib/format";
import type { MenuItem } from "@/lib/types";
import { dietaryTags } from "@/lib/dietary";
import { itemSalePrice } from "@/lib/pricing";
import { useT } from "@/lib/i18n/context";
import { RatingIcon } from "@/components/ui/icons";

/** A single tappable row in the menu list. */
export default function MenuItemRow({
  item,
  currency,
  promoLabel,
  rating,
  onSelect,
}: {
  item: MenuItem;
  currency: string;
  /** Name of a quantity deal covering this item, e.g. "2x1 Tacos". */
  promoLabel?: string;
  /** Average score, only present once the dish has enough ratings to show one. */
  rating?: { avg: number; count: number };
  onSelect: (item: MenuItem) => void;
}) {
  const t = useT();
  const pct = item.discount_pct ?? 0;
  const onSale = pct > 0;
  const sale = itemSalePrice(item.price, pct);
  return (
    <div className="tt-item" onClick={() => onSelect(item)}>
      {/* Name, then price, then description — you scan a menu by dish and
          cost, so those two sit together at the top rather than with the
          price stranded under a paragraph of ingredients. */}
      <div className="tt-item-body">
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <strong style={{ fontSize: 15 }}>{item.name}</strong>
          {item.popular && <span className="tt-pop">{t("menu.popular")}</span>}
        </div>
        <div className="tt-price" style={{ fontSize: 15 }}>
          {onSale && <s className="tt-was">{formatMoney(item.price, currency)}</s>}
          {formatMoney(onSale ? sale : item.price, currency)}
        </div>
        {(onSale || promoLabel) && (
          <div className="tt-tag-row">
            {onSale && <span className="tt-sale">{t("menu.percentOff", { pct })}</span>}
            {promoLabel && <span className="tt-deal">{promoLabel}</span>}
          </div>
        )}
        {rating && (
          <div className="tt-rating-inline">
            <RatingIcon size={12} weight="fill" className="tt-star-on" />
            {rating.avg.toFixed(1)}
            <span className="tt-rating-count">({rating.count})</span>
          </div>
        )}
        <div className="tt-desc tt-muted">{item.description}</div>
        {dietaryTags(item.dietary).length > 0 && (
          <div className="tt-diet-row">
            {dietaryTags(item.dietary).map(tag => (
              <span
                key={tag.key}
                className="tt-diet-badge"
                title={t(`dietary.${tag.key}`)}
              >
                {tag.emoji} {t(`dietary.${tag.key}`)}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="tt-item-media">
        <div className="tt-thumb">{item.emoji || "🍽️"}</div>
        <button
          type="button"
          className="tt-plus"
          aria-label={t("menu.addItem", { name: item.name })}
          onClick={e => {
            e.stopPropagation();
            onSelect(item);
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}
