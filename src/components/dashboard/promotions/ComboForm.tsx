"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n/context";
import type { MenuItem } from "@/lib/types";
import type { PromotionInput } from "@/hooks/usePromotions";

/**
 * Builds a combo: pick the products, name it, set the bundle price. Shows the
 * regular total and the saving live, so the manager can see what they're
 * giving away before saving.
 */
export default function ComboForm({
  products,
  currency,
  saving,
  onSubmit,
}: {
  products: MenuItem[];
  currency: string;
  saving: boolean;
  onSubmit: (input: PromotionInput) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🎁");
  const [price, setPrice] = useState("");
  const [picked, setPicked] = useState<Record<string, number>>({});

  const chosen = Object.entries(picked).filter(([, qty]) => qty > 0);
  const regular = chosen.reduce((sum, [id, qty]) => {
    const p = products.find(i => i.id === id);
    return sum + (p ? Number(p.price) * qty : 0);
  }, 0);
  const comboPrice = Number(price) || 0;
  const savingAmount = Math.round((regular - comboPrice) * 100) / 100;
  const ready = name.trim() && chosen.length >= 2 && comboPrice > 0;

  function bump(id: string, delta: number) {
    setPicked(prev => {
      const next = Math.max(0, (prev[id] ?? 0) + delta);
      return { ...prev, [id]: next };
    });
  }

  return (
    <form
      className="tt-coupon-form"
      onSubmit={e => {
        e.preventDefault();
        onSubmit({
          kind: "combo",
          name: name.trim(),
          emoji,
          comboPrice,
          items: chosen.map(([itemId, qty]) => ({ itemId, qty })),
        });
        setName("");
        setPrice("");
        setPicked({});
      }}
    >
      <div className="tt-prodform-row">
        <input
          className="tt-input"
          style={{ width: 64, textAlign: "center" }}
          value={emoji}
          onChange={e => setEmoji(e.target.value)}
          aria-label={t("promos.emoji")}
        />
        <input
          className="tt-input"
          style={{ flex: 1 }}
          placeholder={t("promos.namePlaceholder")}
          value={name}
          onChange={e => setName(e.target.value)}
          required
        />
        <input
          className="tt-input"
          style={{ width: 110 }}
          type="number"
          min="0"
          step="0.01"
          placeholder={t("promos.comboPrice")}
          value={price}
          onChange={e => setPrice(e.target.value)}
          required
        />
      </div>

      <div className="tt-mod-label">{t("promos.pickProducts")}</div>
      <div className="tt-chips">
        {products.map(p => {
          const qty = picked[p.id] ?? 0;
          return (
            <span key={p.id} className={`tt-chip ${qty > 0 ? "tt-chip-on" : ""}`}>
              <button type="button" className="tt-chip-btn" onClick={() => bump(p.id, 1)}>
                {p.emoji} {p.name} · {formatMoney(Number(p.price), currency)}
              </button>
              {qty > 0 && (
                <>
                  <span className="tt-chip-qty">×{qty}</span>
                  <button
                    type="button"
                    className="tt-chip-btn"
                    aria-label={t("promos.removeOne", { name: p.name })}
                    onClick={() => bump(p.id, -1)}
                  >
                    −
                  </button>
                </>
              )}
            </span>
          );
        })}
      </div>

      {chosen.length > 0 && (
        <p className="tt-muted" style={{ margin: 0, fontSize: 13 }}>
          {t("promos.regularTotal")} <s>{formatMoney(regular, currency)}</s>{" "}
          {comboPrice > 0 && (
            <>
              → <strong className="tt-accent">{formatMoney(comboPrice, currency)}</strong>{" "}
              {savingAmount > 0 ? (
                <span className="tt-save">
                  {t("promos.saves", { amount: formatMoney(savingAmount, currency) })}
                </span>
              ) : (
                <span style={{ color: "#c0392b" }}>{t("promos.noSaving")}</span>
              )}
            </>
          )}
        </p>
      )}

      <button
        type="submit"
        className="tt-btn tt-btn-primary tt-btn-sm"
        disabled={!ready || saving}
      >
        {saving ? t("common.saving") : t("promos.addCombo")}
      </button>
    </form>
  );
}
