"use client";

import { formatMoney } from "@/lib/format";
import type { MenuItem } from "@/lib/types";
import { dietaryTags } from "@/lib/dietary";
import { itemSalePrice } from "@/lib/pricing";
import { useT } from "@/lib/i18n/context";

/** A single tappable row in the menu list. */
export default function MenuItemRow({
  item,
  currency,
  promoLabel,
  onSelect,
}: {
  item: MenuItem;
  currency: string;
  /** Name of a quantity deal covering this item, e.g. "2x1 Tacos". */
  promoLabel?: string;
  onSelect: (item: MenuItem) => void;
}) {
  const t = useT();
  const pct = item.discount_pct ?? 0;
  const onSale = pct > 0;
  const sale = itemSalePrice(item.price, pct);
  return (
    <div className="tt-card tt-item" onClick={() => onSelect(item)}>
      <div className="tt-thumb">{item.emoji || "🍽️"}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <strong style={{ fontSize: 15 }}>{item.name}</strong>
          {item.popular && <span className="tt-pop">{t("menu.popular")}</span>}
          {onSale && <span className="tt-sale">{t("menu.percentOff", { pct })}</span>}
          {promoLabel && <span className="tt-deal">{promoLabel}</span>}
        </div>
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
        <div className="tt-price" style={{ fontSize: 16 }}>
          {onSale && (
            <s className="tt-was">{formatMoney(item.price, currency)}</s>
          )}
          {formatMoney(onSale ? sale : item.price, currency)}
        </div>
      </div>
      <div className="tt-plus">+</div>
    </div>
  );
}
