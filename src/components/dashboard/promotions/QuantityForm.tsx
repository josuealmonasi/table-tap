"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n/context";
import { promoCost } from "@/lib/promo-math";
import type { Category, MenuItem } from "@/lib/types";
import type { PromotionInput } from "@/hooks/usePromotions";
import ProductPicker from "./ProductPicker";
import PickedProducts from "./PickedProducts";
import { DeleteIcon } from "@/components/ui/icons";
import type { PromotionWithItems } from "@/lib/promotions";

/**
 * Builds a quantity deal: "buy N, pay for M" (2x1, 3x1) or bracket pricing
 * ("1 for 5, 2 for 8"). Like the combo form, the name, the normal-vs-deal
 * comparison and the submit button share one row.
 */
export default function QuantityForm({
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
  const [kind, setKind] = useState<"bogo" | "tiered">(
    initial?.kind === "tiered" ? "tiered" : "bogo",
  );
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [buyQty, setBuyQty] = useState(String(initial?.buy_qty ?? 2));
  const [payQty, setPayQty] = useState(String(initial?.pay_qty ?? 1));
  const [tiers, setTiers] = useState<{ qty: string; price: string }[]>(
    initial?.tiers?.map(t => ({ qty: String(t.qty), price: String(t.price) })) ?? [
      { qty: "2", price: "" },
    ],
  );
  const [picked, setPicked] = useState<{ id: string; qty: number }[]>(
    initial?.items.map(i => ({ id: i.item_id, qty: i.qty })) ?? [],
  );

  const firstItem = products.find(p => p.id === picked[0]?.id);
  const unit = firstItem ? Number(firstItem.price) : 0;

  const parsedTiers = tiers
    .map(row => ({ qty: Math.floor(Number(row.qty)), price: Number(row.price) }))
    .filter(row => row.qty > 0 && Number.isFinite(row.price) && row.price >= 0);

  const buy = Math.floor(Number(buyQty));
  const pay = Math.floor(Number(payQty));
  const validBogo = buy >= 2 && pay >= 1 && pay < buy;
  const ready =
    name.trim() &&
    picked.length > 0 &&
    (kind === "bogo" ? validBogo : parsedTiers.length > 0);

  /** What the customer pays at the deal quantity, using the first product. */
  const preview = (() => {
    if (!firstItem) return null;
    const qty = kind === "bogo" ? buy : Math.max(...parsedTiers.map(x => x.qty), 0);
    if (!qty) return null;
    const cost = promoCost(
      { id: "x", name: "x", kind, buyQty: buy, payQty: pay, tiers: parsedTiers },
      qty,
      unit,
    );
    return { qty, normal: Math.round(qty * unit * 100) / 100, cost };
  })();

  function bump(id: string, delta: number) {
    // A quantity deal just needs the product listed, so "−" removes it.
    if (delta < 0) setPicked(prev => prev.filter(p => p.id !== id));
  }

  return (
    <form
      className="tt-promo-form"
      onSubmit={e => {
        e.preventDefault();
        onSubmit({
          kind,
          name: name.trim(),
          emoji: kind === "bogo" ? "🏷️" : "🔖",
          description: description.trim() || null,
          buyQty: kind === "bogo" ? buy : null,
          payQty: kind === "bogo" ? pay : null,
          tiers: kind === "tiered" ? parsedTiers : null,
          items: picked.map(p => ({ itemId: p.id, qty: 1 })),
        });
        if (initial) return; // editing keeps its values; the list replaces the form
        setName("");
        setDescription("");
        setPicked([]);
        setTiers([{ qty: "2", price: "" }]);
      }}
    >
      <div className="tt-promo-toprow">
        <select
          className="tt-input tt-promo-kind"
          value={kind}
          onChange={e => setKind(e.target.value as "bogo" | "tiered")}
          aria-label={t("promos.dealType")}
        >
          <option value="bogo">{t("promos.kindBogo")}</option>
          <option value="tiered">{t("promos.kindTiered")}</option>
        </select>
        <input
          className="tt-input tt-promo-name"
          placeholder={t("promos.dealNamePlaceholder")}
          value={name}
          onChange={e => setName(e.target.value)}
          required
        />
        <div className="tt-promo-compare" aria-live="polite">
          {preview && preview.normal > preview.cost ? (
            <>
              <span className="tt-muted">
                {preview.qty}× {firstItem!.name}
              </span>{" "}
              <s>{formatMoney(preview.normal, currency)}</s>
              {" → "}
              <strong className="tt-accent">
                {formatMoney(preview.cost, currency)}
              </strong>{" "}
              <span className="tt-save">
                {t("promos.saves", {
                  amount: formatMoney(
                    Math.round((preview.normal - preview.cost) * 100) / 100,
                    currency,
                  ),
                })}
              </span>
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
              : t("promos.addDeal")}
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

      <input
        className="tt-input"
        placeholder={t("promos.descriptionPlaceholder")}
        value={description}
        onChange={e => setDescription(e.target.value)}
      />

      {kind === "bogo" ? (
        <div className="tt-promo-terms">
          <span className="tt-muted">{t("promos.buyLabel")}</span>
          <input
            className="tt-input tt-qty-input"
            type="number"
            min="2"
            value={buyQty}
            onChange={e => setBuyQty(e.target.value)}
            aria-label={t("promos.buyLabel")}
          />
          <span className="tt-muted">{t("promos.payLabel")}</span>
          <input
            className="tt-input tt-qty-input"
            type="number"
            min="1"
            value={payQty}
            onChange={e => setPayQty(e.target.value)}
            aria-label={t("promos.payLabel")}
          />
        </div>
      ) : (
        <div className="tt-promo-tiers">
          {tiers.map((row, i) => (
            <div className="tt-promo-terms" key={i}>
              <input
                className="tt-input tt-qty-input"
                type="number"
                min="1"
                value={row.qty}
                onChange={e =>
                  setTiers(prev =>
                    prev.map((r, j) => (j === i ? { ...r, qty: e.target.value } : r)),
                  )
                }
                aria-label={t("promos.tierQty")}
              />
              <span className="tt-muted">→</span>
              <input
                className="tt-input tt-promo-price"
                type="number"
                min="0"
                step="0.01"
                placeholder={currency}
                value={row.price}
                onChange={e =>
                  setTiers(prev =>
                    prev.map((r, j) => (j === i ? { ...r, price: e.target.value } : r)),
                  )
                }
                aria-label={t("promos.tierPrice")}
              />
              {tiers.length > 1 && (
                <button
                  type="button"
                  className="tt-iconbtn"
                  onClick={() => setTiers(prev => prev.filter((_, j) => j !== i))}
                  title={t("promos.removeTier")}
                >
                  <DeleteIcon size={16} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="tt-btn tt-btn-ghost tt-btn-sm"
            style={{ alignSelf: "flex-start" }}
            onClick={() => setTiers(prev => [...prev, { qty: "", price: "" }])}
          >
            {t("promos.addTier")}
          </button>
        </div>
      )}

      <ProductPicker
        products={products}
        categories={categories}
        currency={currency}
        pickedIds={picked.map(p => p.id)}
        onPick={p => setPicked(prev => [...prev, { id: p.id, qty: 1 }])}
      />

      <PickedProducts
        label={t("promos.appliesTo")}
        emptyLabel={t("promos.nonePicked")}
        picked={picked}
        products={products}
        currency={currency}
        onBump={bump}
        showQty={false}
      />
    </form>
  );
}
