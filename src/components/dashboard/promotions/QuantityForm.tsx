"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n/context";
import { promoCost } from "@/lib/promo-math";
import type { MenuItem } from "@/lib/types";
import type { PromotionInput } from "@/hooks/usePromotions";

/**
 * Builds a quantity deal: either "buy N, pay for M" (2x1, 3x1) or bracket
 * pricing ("1 for 5, 2 for 8"). Both preview what the customer would pay, so
 * a deal that gives away more than intended is obvious before saving.
 */
export default function QuantityForm({
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
  const [kind, setKind] = useState<"bogo" | "tiered">("bogo");
  const [name, setName] = useState("");
  const [buyQty, setBuyQty] = useState("2");
  const [payQty, setPayQty] = useState("1");
  const [tiers, setTiers] = useState<{ qty: string; price: string }[]>([
    { qty: "2", price: "" },
  ]);
  const [picked, setPicked] = useState<string[]>([]);

  const firstItem = products.find(p => p.id === picked[0]);
  const unit = firstItem ? Number(firstItem.price) : 0;

  const parsedTiers = tiers
    .map(row => ({ qty: Math.floor(Number(row.qty)), price: Number(row.price) }))
    .filter(row => row.qty > 0 && Number.isFinite(row.price) && row.price >= 0);

  const buy = Math.floor(Number(buyQty));
  const pay = Math.floor(Number(payQty));
  const validBogo = buy >= 2 && pay >= 1 && pay < buy;
  const ready =
    name.trim() && picked.length > 0 && (kind === "bogo" ? validBogo : parsedTiers.length > 0);

  /** What the customer pays for the deal quantity, using the first product's price. */
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

  function toggle(id: string) {
    setPicked(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  }

  return (
    <form
      className="tt-coupon-form"
      onSubmit={e => {
        e.preventDefault();
        onSubmit({
          kind,
          name: name.trim(),
          emoji: kind === "bogo" ? "🏷️" : "🔖",
          buyQty: kind === "bogo" ? buy : null,
          payQty: kind === "bogo" ? pay : null,
          tiers: kind === "tiered" ? parsedTiers : null,
          items: picked.map(itemId => ({ itemId, qty: 1 })),
        });
        setName("");
        setPicked([]);
        setTiers([{ qty: "2", price: "" }]);
      }}
    >
      <div className="tt-prodform-row">
        <select
          className="tt-input"
          style={{ width: 160 }}
          value={kind}
          onChange={e => setKind(e.target.value as "bogo" | "tiered")}
        >
          <option value="bogo">{t("promos.kindBogo")}</option>
          <option value="tiered">{t("promos.kindTiered")}</option>
        </select>
        <input
          className="tt-input"
          style={{ flex: 1 }}
          placeholder={t("promos.dealNamePlaceholder")}
          value={name}
          onChange={e => setName(e.target.value)}
          required
        />
      </div>

      {kind === "bogo" ? (
        <div className="tt-prodform-row" style={{ alignItems: "center" }}>
          <span className="tt-muted" style={{ fontSize: 13 }}>
            {t("promos.buyLabel")}
          </span>
          <input
            className="tt-input"
            style={{ width: 70 }}
            type="number"
            min="2"
            value={buyQty}
            onChange={e => setBuyQty(e.target.value)}
          />
          <span className="tt-muted" style={{ fontSize: 13 }}>
            {t("promos.payLabel")}
          </span>
          <input
            className="tt-input"
            style={{ width: 70 }}
            type="number"
            min="1"
            value={payQty}
            onChange={e => setPayQty(e.target.value)}
          />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {tiers.map((row, i) => (
            <div className="tt-prodform-row" key={i} style={{ alignItems: "center" }}>
              <input
                className="tt-input"
                style={{ width: 70 }}
                type="number"
                min="1"
                value={row.qty}
                onChange={e =>
                  setTiers(prev => prev.map((r, j) => (j === i ? { ...r, qty: e.target.value } : r)))
                }
                aria-label={t("promos.tierQty")}
              />
              <span className="tt-muted">→</span>
              <input
                className="tt-input"
                style={{ width: 110 }}
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
                  🗑️
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

      <div className="tt-mod-label">{t("promos.appliesTo")}</div>
      <div className="tt-chips">
        {products.map(p => (
          <button
            type="button"
            key={p.id}
            className={`tt-chip ${picked.includes(p.id) ? "tt-chip-on" : ""}`}
            onClick={() => toggle(p.id)}
          >
            {p.emoji} {p.name} · {formatMoney(Number(p.price), currency)}
          </button>
        ))}
      </div>

      {preview && preview.normal > preview.cost && (
        <p className="tt-muted" style={{ margin: 0, fontSize: 13 }}>
          {t("promos.dealPreview", {
            qty: preview.qty,
            name: firstItem!.name,
            normal: formatMoney(preview.normal, currency),
            cost: formatMoney(preview.cost, currency),
          })}
        </p>
      )}

      <button
        type="submit"
        className="tt-btn tt-btn-primary tt-btn-sm"
        disabled={!ready || saving}
      >
        {saving ? t("common.saving") : t("promos.addDeal")}
      </button>
    </form>
  );
}
