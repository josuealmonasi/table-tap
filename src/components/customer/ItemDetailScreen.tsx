"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import type { MenuItem, Modifier, OrderLineItem } from "@/lib/types";
import { dietaryTags } from "@/lib/dietary";
import ModifierGroup from "./ModifierGroup";

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
  const [mods, setMods] = useState<Record<string, string | string[]>>(
    initialLine?.mods ?? {},
  );
  const [extraIds, setExtraIds] = useState<string[]>(
    initialLine?.extras?.map(e => e.id) ?? [],
  );
  const [qty, setQty] = useState(initialLine?.qty ?? 1);
  const [notes, setNotes] = useState(initialLine?.notes ?? "");

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
  const unitPrice = item.price + extrasTotal;

  function handleAdd() {
    onAdd({
      itemId: item.id,
      name: item.name,
      emoji: item.emoji,
      price: item.price,
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
        <button className="tt-back" onClick={onBack}>
          ←
        </button>
      </div>
      <div style={{ padding: 20 }}>
        <div className="tt-row">
          <h2 className="tt-serif" style={{ margin: 0, fontSize: 24 }}>
            {item.name}
          </h2>
          <span className="tt-price-lg">{formatMoney(item.price, currency)}</span>
        </div>
        <p className="tt-muted" style={{ lineHeight: 1.6 }}>
          {item.description}
        </p>

        {dietaryTags(item.dietary).length > 0 && (
          <div className="tt-diet-row" style={{ marginBottom: 16 }}>
            {dietaryTags(item.dietary).map(t => (
              <span key={t.key} className="tt-diet-badge" title={t.label}>
                {t.emoji} {t.label}
              </span>
            ))}
          </div>
        )}

        {item.modifiers.map(mod => (
          <ModifierGroup
            key={mod.label}
            modifier={mod}
            value={mods[mod.label]}
            onToggle={option => toggleMod(mod.label, option, mod.type)}
          />
        ))}

        {extras.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div className="tt-mod-label">
              Add extras <span className="tt-muted">(optional)</span>
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
          <div className="tt-mod-label">Special requests</div>
          <textarea
            className="tt-input"
            rows={2}
            placeholder="Allergies, preferences…"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <div className="tt-stepper">
            <button onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
            <span>{qty}</span>
            <button onClick={() => setQty(q => q + 1)}>+</button>
          </div>
          <button
            className="tt-btn tt-btn-primary"
            style={{ flex: 1 }}
            onClick={handleAdd}
          >
            {initialLine ? "Update item" : "Add to cart"} —{" "}
            {formatMoney(unitPrice * qty, currency)}
          </button>
        </div>
      </div>
    </div>
  );
}
