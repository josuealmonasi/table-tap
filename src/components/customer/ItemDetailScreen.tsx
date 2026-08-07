"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import type { MenuItem, Modifier, OrderLineItem } from "@/lib/types";
import { dietaryTags } from "@/lib/dietary";
import { itemSalePrice } from "@/lib/pricing";
import { missingRequired } from "@/lib/modifiers";
import { useT } from "@/lib/i18n/context";
import ModifierGroup from "./ModifierGroup";
import { BackIcon } from "@/components/ui/icons";

/** Item customisation screen: modifiers, extras, special requests, qty → add to cart. */
export default function ItemDetailScreen({
  item,
  extras,
  currency,
  onBack,
  onAdd,
  initialLine,
}: {
  item: MenuItem;
  extras: MenuItem[];
  currency: string;
  onBack: () => void;
  onAdd: (line: OrderLineItem) => void;
  /** Editing an existing cart line: prefills choices and relabels the button. */
  initialLine?: OrderLineItem;
}) {
  const t = useT();
  const [mods, setMods] = useState<Record<string, string | string[]>>(
    initialLine?.mods ?? {},
  );
  const [extraIds, setExtraIds] = useState<string[]>(
    initialLine?.extras?.map(e => e.id) ?? [],
  );
  const [qty, setQty] = useState(initialLine?.qty ?? 1);
  const [notes, setNotes] = useState(initialLine?.notes ?? "");
  // Only after a blocked attempt — flagging groups red on open would tell a
  // customer they'd done something wrong before they'd done anything.
  const [showMissing, setShowMissing] = useState(false);

  // Same rule the checkout route re-runs server-side against DB modifiers.
  const missing = missingRequired(item.modifiers, mods);

  function toggleMod(label: string, option: string, type: Modifier["type"]) {
    setMods(prev => {
      if (type === "single") return { ...prev, [label]: option };
      const cur = (prev[label] as string[]) ?? [];
      return {
        ...prev,
        [label]: cur.includes(option) ? cur.filter(o => o !== option) : [...cur, option],
      };
    });
  }

  function toggleExtra(id: string) {
    setExtraIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  }

  const chosenExtras = extras.filter(e => extraIds.includes(e.id));
  const extrasTotal = chosenExtras.reduce((sum, e) => sum + e.price, 0);
  // Extras are never discounted, so only the base price gets the % off.
  const onSale = (item.discount_pct ?? 0) > 0;
  const salePrice = itemSalePrice(item.price, item.discount_pct);
  const unitPrice = salePrice + extrasTotal;

  function handleAdd() {
    if (missing.length > 0) {
      setShowMissing(true);
      return;
    }
    onAdd({
      itemId: item.id,
      name: item.name,
      emoji: item.emoji,
      // The full price plus the discount travels with the line; checkout
      // re-reads both from the DB, so this is a snapshot, never the authority.
      price: item.price,
      discountPct: item.discount_pct ?? 0,
      qty,
      mods,
      extras: chosenExtras.map(e => ({
        id: e.id,
        name: e.name,
        emoji: e.emoji,
        price: e.price,
      })),
      notes: notes || undefined,
    });
  }

  return (
    <div className="tt-root">
      <div className="tt-item-hero">
        <span>{item.emoji || "🍽️"}</span>
        <button className="tt-back" onClick={onBack} aria-label={t("common.back")}>
          <BackIcon size={18} weight="bold" />
        </button>
      </div>
      <div style={{ padding: 20 }}>
        <div className="tt-row">
          <h2 className="tt-serif" style={{ margin: 0, fontSize: 24 }}>
            {item.name}
          </h2>
          <span className="tt-price-lg">
            {onSale && <s className="tt-was">{formatMoney(item.price, currency)}</s>}
            {formatMoney(onSale ? salePrice : item.price, currency)}
          </span>
        </div>
        <p className="tt-muted" style={{ lineHeight: 1.6 }}>
          {item.description}
        </p>

        {dietaryTags(item.dietary).length > 0 && (
          <div className="tt-diet-row" style={{ marginBottom: 16 }}>
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

        {item.modifiers.map(mod => (
          <ModifierGroup
            key={mod.label}
            modifier={mod}
            value={mods[mod.label]}
            missing={showMissing && missing.includes(mod.label)}
            onToggle={option => toggleMod(mod.label, option, mod.type)}
          />
        ))}

        {extras.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div className="tt-mod-label">
              {t("item.addExtras")} <span className="tt-muted">{t("item.optional")}</span>
            </div>
            <div className="tt-chips">
              {extras.map(extra => {
                const on = extraIds.includes(extra.id);
                return (
                  <button
                    key={extra.id}
                    className={`tt-chip ${on ? "tt-chip-on" : ""}`}
                    onClick={() => toggleExtra(extra.id)}
                  >
                    {extra.emoji ? `${extra.emoji} ` : ""}
                    {extra.name}
                    {extra.price > 0 ? ` +${formatMoney(extra.price, currency)}` : ""}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ marginBottom: 20 }}>
          <div className="tt-mod-label">{t("item.specialRequests")}</div>
          <textarea
            className="tt-input"
            rows={2}
            placeholder={t("item.requestsPlaceholder")}
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        {/* Pinned to the bottom of the scroll area. A dish with a dozen extras
            and nine dietary tags pushes this well past the fold, and an
            "Add to cart" you have to go looking for is the one control on the
            screen that must never need finding. */}
        {missing.length > 0 && (
          <p className="tt-req-note" role="status">
            {t("item.chooseFirst", { groups: missing.join(", ") })}
          </p>
        )}
        <div className="tt-detail-actions">
          <div className="tt-stepper">
            <button onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
            <span>{qty}</span>
            <button onClick={() => setQty(q => q + 1)}>+</button>
          </div>
          <button
            className="tt-btn tt-btn-primary"
            style={{ flex: 1 }}
            disabled={missing.length > 0}
            onClick={handleAdd}
          >
            {t(initialLine ? "item.updateItem" : "item.addToCart")} —{" "}
            {formatMoney(unitPrice * qty, currency)}
          </button>
        </div>
      </div>
    </div>
  );
}
