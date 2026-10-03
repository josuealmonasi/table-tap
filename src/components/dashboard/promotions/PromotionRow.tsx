"use client";

import { formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n/context";
import type { PromotionWithItems } from "@/lib/promotions";
import type { Category, MenuItem } from "@/lib/types";
import { DeleteIcon, EditIcon, WarningIcon } from "@/components/ui/icons";
import { comboReachProblem } from "@/lib/combo-reach";
import { promotionItemNames } from "@/lib/promotion-names";

interface PromotionRowProps {
  promotion: PromotionWithItems;
  products: MenuItem[];
  itemsById: Map<string, MenuItem>;
  categoriesById: Map<string, Category>;
  activeMenuIds: Set<string>;
  currency: string;
  onEdit: (p: PromotionWithItems) => void;
  onToggle: (p: PromotionWithItems) => void;
  onDelete: (p: PromotionWithItems) => void;
}

/** One combo or deal: what it does, whether a diner can reach it, and its controls. */
export default function PromotionRow({
  promotion: p,
  products,
  itemsById,
  categoriesById,
  activeMenuIds,
  currency,
  onEdit,
  onToggle,
  onDelete,
}: PromotionRowProps) {
  const t = useT();

  /** One line describing what the promotion does. */
  function describe(): string {
    const names = promotionItemNames(p, products);
    if (p.kind === "combo") {
      return `${names} — ${formatMoney(Number(p.combo_price ?? 0), currency)}`;
    }
    if (p.kind === "bogo") {
      return t("promos.bogoDesc", { buy: p.buy_qty ?? 0, pay: p.pay_qty ?? 0, names });
    }
    const tiers = (p.tiers ?? [])
      .map(tier => `${tier.qty} → ${formatMoney(tier.price, currency)}`)
      .join(" · ");
    return `${names} — ${tiers}`;
  }

  return (
    <div className="tt-coupon-item">
      <div style={{ minWidth: 0 }}>
        <strong>
          <button
            type="button"
            className="tt-prod-name"
            onClick={() => onEdit(p)}
            title={t("promos.edit")}
          >
            {p.emoji} {p.name}
          </button>
        </strong>
        {!p.active && <span className="tt-coupon-off">{t("promos.paused")}</span>}
        <div className="tt-muted" style={{ fontSize: 13 }}>
          {describe()}
        </div>
        {(() => {
          const problem = comboReachProblem(p, itemsById, categoriesById, activeMenuIds);
          if (!problem) return null;
          return (
            <div className="tt-promo-warn">
              <WarningIcon size={14} weight="bold" />
              <span>
                {problem.itemName
                  ? t(
                      problem.reason === "unavailable"
                        ? "promos.hiddenUnavailable"
                        : "promos.hiddenOffMenu",
                      { item: problem.itemName },
                    )
                  : t("promos.hiddenMissing")}
              </span>
            </div>
          );
        })()}
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => onToggle(p)}>
          {p.active ? t("promos.pause") : t("promos.resume")}
        </button>
        <button className="tt-iconbtn" title={t("promos.edit")} onClick={() => onEdit(p)}>
          <EditIcon size={16} />
        </button>
        <button
          className="tt-iconbtn"
          title={t("promos.delete")}
          onClick={() => onDelete(p)}
        >
          <DeleteIcon size={16} />
        </button>
      </div>
    </div>
  );
}
