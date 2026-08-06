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
    <div className="tt-card tt-item tt-combo" onClick={() => onAdd(combo)}>
      <div className="tt-thumb">{combo.emoji || "🎁"}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <strong style={{ fontSize: 15 }}>{combo.name}</strong>
          {saving > 0 && (
            <span className="tt-sale">
              {t("combo.save", { amount: formatMoney(saving, currency) })}
            </span>
          )}
        </div>
        <div className="tt-desc tt-muted">
          {combo.description ||
            combo.components
              .map(c => (c.qty > 1 ? `${c.qty}× ${c.name}` : c.name))
              .join(" + ")}
        </div>
        <div className="tt-price" style={{ fontSize: 16 }}>
          {saving > 0 && (
            <s className="tt-was">{formatMoney(combo.regularPrice, currency)}</s>
          )}
          {formatMoney(combo.price, currency)}
        </div>
      </div>
      <div className="tt-plus">+</div>
    </div>
  );
}
