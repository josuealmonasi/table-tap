"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import type { MenuItem, Modifier, OrderLineItem } from "@/lib/types";
import ModifierGroup from "./ModifierGroup";

/** Item customisation screen: modifiers, special requests, quantity → add to cart. */
export default function ItemDetailScreen({
  item,
  currency,
  onBack,
  onAdd,
}: {
  item: MenuItem;
  currency: string;
  onBack: () => void;
  onAdd: (line: OrderLineItem) => void;
}) {
  const [mods, setMods] = useState<Record<string, string | string[]>>({});
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");

  function toggleMod(label: string, option: string, type: Modifier["type"]) {
    setMods((prev) => {
      if (type === "single") return { ...prev, [label]: option };
      const cur = (prev[label] as string[]) ?? [];
      return {
        ...prev,
        [label]: cur.includes(option) ? cur.filter((o) => o !== option) : [...cur, option],
      };
    });
  }

  function handleAdd() {
    onAdd({
      itemId: item.id,
      name: item.name,
      emoji: item.emoji,
      price: item.price,
      qty,
      mods,
      notes: notes || undefined,
    });
  }

  return (
    <div className="tt-root">
      <div className="tt-item-hero">
        <span>{item.emoji}</span>
        <button className="tt-back" onClick={onBack}>←</button>
      </div>
      <div style={{ padding: 20 }}>
        <div className="tt-row">
          <h2 className="tt-serif" style={{ margin: 0, fontSize: 24 }}>{item.name}</h2>
          <span className="tt-price-lg">{formatMoney(item.price, currency)}</span>
        </div>
        <p className="tt-muted" style={{ lineHeight: 1.6 }}>{item.description}</p>

        {item.modifiers.map((mod) => (
          <ModifierGroup
            key={mod.label}
            modifier={mod}
            value={mods[mod.label]}
            onToggle={(option) => toggleMod(mod.label, option, mod.type)}
          />
        ))}

        <div style={{ marginBottom: 20 }}>
          <div className="tt-mod-label">Special requests</div>
          <textarea
            className="tt-input"
            rows={2}
            placeholder="Allergies, preferences…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <div className="tt-stepper">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
            <span>{qty}</span>
            <button onClick={() => setQty((q) => q + 1)}>+</button>
          </div>
          <button className="tt-btn tt-btn-primary" style={{ flex: 1 }} onClick={handleAdd}>
            Add to cart — {formatMoney(item.price * qty, currency)}
          </button>
        </div>
      </div>
    </div>
  );
}
