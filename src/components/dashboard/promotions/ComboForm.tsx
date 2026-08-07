"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n/context";
import type { Category, MenuItem } from "@/lib/types";
import type { PromotionInput } from "@/hooks/usePromotions";
import type { PromotionWithItems } from "@/lib/promotions";
import ProductPicker from "./ProductPicker";
import PickedProducts from "./PickedProducts";

/**
 * Builds a combo: search for products, set a bundle price. The name, price,
 * regular-vs-combo comparison and the submit button share one row, so the
 * manager can weigh the discount without looking away from the price field.
 */
export default function ComboForm({
  products,
  categories,
  currency,
  saving,
  onSubmit,
  initial,
  onCancel,
}: {
  products: MenuItem[];
  categories: Category[];
  currency: string;
  saving: boolean;
  onSubmit: (input: PromotionInput) => void;
  /** Present when editing an existing deal rather than creating one. */
  initial?: PromotionWithItems;
  onCancel?: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(initial?.name ?? "");
  const [emoji, setEmoji] = useState(initial?.emoji ?? "🎁");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [price, setPrice] = useState(
    initial?.combo_price != null ? String(initial.combo_price) : "",
  );
  const [picked, setPicked] = useState<{ id: string; qty: number }[]>(
    initial?.items.map(i => ({ id: i.item_id, qty: i.qty })) ?? [],
  );

  const regular = picked.reduce((sum, p) => {
    const item = products.find(i => i.id === p.id);
    return sum + (item ? Number(item.price) * p.qty : 0);
  }, 0);
  const comboPrice = Number(price) || 0;
  const savingAmount = Math.round((regular - comboPrice) * 100) / 100;
  const ready = name.trim() && picked.length >= 2 && comboPrice > 0;

  function bump(id: string, delta: number) {
    setPicked(prev =>
      prev
        .map(p => (p.id === id ? { ...p, qty: p.qty + delta } : p))
        .filter(p => p.qty > 0),
    );
  }

  return (
    <form
      className="tt-promo-form"
      onSubmit={e => {
        e.preventDefault();
        onSubmit({
          kind: "combo",
          name: name.trim(),
          emoji,
          description: description.trim() || null,
          comboPrice,
          items: picked.map(p => ({ itemId: p.id, qty: p.qty })),
        });
        // Editing keeps its values — the form is replaced by the list on save.
        if (initial) return;
        setName("");
        setDescription("");
        setPrice("");
        setPicked([]);
      }}
    >
      {/* Name, price, the comparison and submit all on one line. */}
      <div className="tt-promo-toprow">
        <input
          className="tt-input tt-emoji-input"
          value={emoji}
          onChange={e => setEmoji(e.target.value)}
          aria-label={t("promos.emoji")}
        />
        <input
          className="tt-input tt-promo-name"
          placeholder={t("promos.namePlaceholder")}
          value={name}
          onChange={e => setName(e.target.value)}
          required
        />
        <input
          className="tt-input tt-promo-price"
          type="number"
          min="0"
          step="0.01"
          placeholder={t("promos.comboPrice")}
          value={price}
          onChange={e => setPrice(e.target.value)}
          aria-label={t("promos.comboPrice")}
          required
        />
        <div className="tt-promo-compare" aria-live="polite">
          {picked.length > 0 ? (
            <>
              <span className="tt-muted">{t("promos.regularTotal")}</span>{" "}
              <s>{formatMoney(regular, currency)}</s>
              {comboPrice > 0 &&
                (savingAmount > 0 ? (
                  <>
                    {" → "}
                    <strong className="tt-accent">
                      {formatMoney(comboPrice, currency)}
                    </strong>{" "}
                    <span className="tt-save">
                      {t("promos.saves", { amount: formatMoney(savingAmount, currency) })}
                    </span>
                  </>
                ) : (
                  <span className="tt-warn"> {t("promos.noSaving")}</span>
                ))}
            </>
          ) : (
            <span className="tt-muted">{t("promos.pickToCompare")}</span>
          )}
        </div>
        <button
          type="submit"
          className="tt-btn tt-btn-primary tt-btn-sm"
          disabled={!ready || saving}
        >
          {saving
            ? t("common.saving")
            : initial
              ? t("promos.saveChanges")
              : t("promos.addCombo")}
        </button>
        {initial && onCancel && (
          <button
            type="button"
            className="tt-btn tt-btn-ghost tt-btn-sm"
            onClick={onCancel}
          >
            {t("menu.cancel")}
          </button>
        )}
      </div>

      {/* Optional: shows under the deal on the customer menu. Without it the
          card falls back to listing the components, which is serviceable but
          says nothing about why the deal is worth having. */}
      <input
        className="tt-input"
        placeholder={t("promos.descriptionPlaceholder")}
        value={description}
        onChange={e => setDescription(e.target.value)}
      />

      <ProductPicker
        products={products}
        categories={categories}
        currency={currency}
        pickedIds={picked.map(p => p.id)}
        onPick={p => setPicked(prev => [...prev, { id: p.id, qty: 1 }])}
      />

      <PickedProducts
        label={t("promos.pickProducts")}
        emptyLabel={t("promos.nonePicked")}
        picked={picked}
        products={products}
        currency={currency}
        onBump={bump}
      />
    </form>
  );
}
