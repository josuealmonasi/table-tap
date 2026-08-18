"use client";

import { formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n/context";
import type { Combo } from "@/lib/promotions";

/**
 * A bundle shown as its own card in the menu. Tapping adds the whole thing as
 * one cart line — combos have no options to pick, so there's no detail screen.
 */
export default function ComboCard({
  combo,
  currency,
  onAdd,
}: {
  combo: Combo;
  currency: string;
  onAdd: (combo: Combo) => void;
}) {
  const t = useT();
  const saving = Math.round((combo.regularPrice - combo.price) * 100) / 100;

  return (
    // Same as a dish row: the whole card opens the bundle, so it answers to a
    // keyboard and announces itself.
    <div
      className="tt-item tt-combo"
      role="button"
      tabIndex={0}
      aria-label={t("menu.openDish", { name: combo.name })}
      onClick={() => onAdd(combo)}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAdd(combo);
        }
      }}
    >
      <div className="tt-item-body">
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <strong style={{ fontSize: 15 }}>{combo.name}</strong>
        </div>
        <div className="tt-price" style={{ fontSize: 15 }}>
          {saving > 0 && (
            <s className="tt-was">{formatMoney(combo.regularPrice, currency)}</s>
          )}
          {formatMoney(combo.price, currency)}
        </div>
        {saving > 0 && (
          <div className="tt-tag-row">
            <span className="tt-sale">
              {t("combo.save", { amount: formatMoney(saving, currency) })}
            </span>
          </div>
        )}
        <div className="tt-desc tt-muted">
          {combo.description ||
            combo.components
              .map(c => (c.qty > 1 ? `${c.qty}× ${c.name}` : c.name))
              .join(" + ")}
        </div>
      </div>
      <div className="tt-item-media">
        <div className="tt-thumb">{combo.emoji || "🎁"}</div>
        <button
          type="button"
          className="tt-plus"
          aria-label={t("menu.addItem", { name: combo.name })}
          onClick={e => {
            e.stopPropagation();
            onAdd(combo);
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}
