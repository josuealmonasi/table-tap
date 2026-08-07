"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import type { MenuItem, OrderLineItem } from "@/lib/types";
import type { Combo } from "@/lib/promotions";
import {
  comboCartLine,
  comboExtras,
  comboMissingRequired,
  type ComponentChoice,
} from "@/lib/combo-config";
import { useT } from "@/lib/i18n/context";
import { BackIcon } from "@/components/ui/icons";
import ModifierGroup from "./ModifierGroup";

/**
 * Configures a bundle before it goes in the cart.
 *
 * A combo used to add itself in one tap, which meant a deal containing a coffee
 * gave no way to ask for oat milk — and no way to answer a required question
 * the same dish would have asked when bought on its own. Each component now
 * gets its own options, and paid extras are charged on top of the deal price:
 * the bundle fixes what the dishes cost, not what an upgrade costs.
 */
export default function ComboDetailScreen({
  combo,
  currency,
  itemsById,
  extrasById,
  extrasByProduct,
  onBack,
  onAdd,
}: {
  combo: Combo;
  currency: string;
  itemsById: Map<string, MenuItem>;
  extrasById: Map<string, MenuItem>;
  /** product_id → addon_id[] */
  extrasByProduct: Record<string, string[]>;
  onBack: () => void;
  onAdd: (line: OrderLineItem) => void;
}) {
  const t = useT();
  const [choices, setChoices] = useState<ComponentChoice[]>([]);
  const [showMissing, setShowMissing] = useState(false);

  const missing = comboMissingRequired(combo.components, choices, itemsById);
  const extrasCost = comboExtras(choices, extrasById).reduce((s, e) => s + e.price, 0);
  const total = combo.price + extrasCost;

  function choiceFor(itemId: string): ComponentChoice {
    return choices.find(c => c.itemId === itemId) ?? { itemId, mods: {}, extraIds: [] };
  }

  function patch(itemId: string, next: Partial<ComponentChoice>): void {
    setChoices(prev => {
      const current = prev.find(c => c.itemId === itemId) ?? {
        itemId,
        mods: {},
        extraIds: [],
      };
      const merged = { ...current, ...next };
      return [...prev.filter(c => c.itemId !== itemId), merged];
    });
  }

  function toggleMod(
    itemId: string,
    label: string,
    option: string,
    type: "single" | "multi",
  ) {
    const current = choiceFor(itemId);
    if (type === "single") {
      patch(itemId, { mods: { ...current.mods, [label]: option } });
      return;
    }
    const chosen = (current.mods[label] as string[]) ?? [];
    patch(itemId, {
      mods: {
        ...current.mods,
        [label]: chosen.includes(option)
          ? chosen.filter(o => o !== option)
          : [...chosen, option],
      },
    });
  }

  function toggleExtra(itemId: string, extraId: string) {
    const current = choiceFor(itemId);
    patch(itemId, {
      extraIds: current.extraIds.includes(extraId)
        ? current.extraIds.filter(id => id !== extraId)
        : [...current.extraIds, extraId],
    });
  }

  function handleAdd() {
    if (missing.length > 0) {
      setShowMissing(true);
      return;
    }
    onAdd(comboCartLine(combo, choices, extrasById));
  }

  return (
    <div className="tt-root">
      <div className="tt-item-hero">
        <span>{combo.emoji || "🎁"}</span>
        <button className="tt-back" onClick={onBack} aria-label={t("common.back")}>
          <BackIcon size={18} weight="bold" />
        </button>
      </div>

      <div style={{ padding: 20 }}>
        <div className="tt-row">
          <h2 className="tt-serif" style={{ margin: 0, fontSize: 24 }}>
            {combo.name}
          </h2>
          <span className="tt-price-lg">
            {combo.regularPrice > combo.price && (
              <s className="tt-was">{formatMoney(combo.regularPrice, currency)}</s>
            )}
            {formatMoney(combo.price, currency)}
          </span>
        </div>
        {combo.description && (
          <p className="tt-muted" style={{ lineHeight: 1.6 }}>
            {combo.description}
          </p>
        )}

        {combo.components.map(component => {
          const product = itemsById.get(component.itemId);
          const choice = choiceFor(component.itemId);
          const offered = (extrasByProduct[component.itemId] ?? [])
            .map(id => extrasById.get(id))
            .filter((e): e is MenuItem => Boolean(e));

          return (
            <section key={component.itemId} className="tt-combo-part">
              <div className="tt-combo-part-head">
                <span className="tt-combo-part-emoji">{component.emoji || "🍽️"}</span>
                <strong>{component.name}</strong>
                {component.qty > 1 && <span className="tt-muted">×{component.qty}</span>}
              </div>

              {product?.modifiers?.map(mod => (
                <ModifierGroup
                  key={mod.label}
                  modifier={mod}
                  value={choice.mods[mod.label]}
                  missing={
                    showMissing && mod.required === true && !choice.mods[mod.label]
                  }
                  onToggle={option =>
                    toggleMod(component.itemId, mod.label, option, mod.type)
                  }
                />
              ))}

              {offered.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div className="tt-mod-label">
                    {t("item.addExtras")}{" "}
                    <span className="tt-muted">{t("combo.extrasCharged")}</span>
                  </div>
                  <div className="tt-chips">
                    {offered.map(e => (
                      <button
                        key={e.id}
                        type="button"
                        className={`tt-chip ${choice.extraIds.includes(e.id) ? "tt-chip-on" : ""}`}
                        onClick={() => toggleExtra(component.itemId, e.id)}
                      >
                        {e.emoji ? `${e.emoji} ` : ""}
                        {e.name}
                        {e.price > 0 ? ` +${formatMoney(e.price, currency)}` : ""}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          );
        })}

        {missing.length > 0 && showMissing && (
          <p className="tt-req-note" role="status">
            {t("item.chooseFirst", { groups: missing.join(", ") })}
          </p>
        )}

        <div className="tt-detail-actions">
          <button
            className="tt-btn tt-btn-primary"
            style={{ flex: 1 }}
            disabled={missing.length > 0}
            onClick={handleAdd}
          >
            {t("item.addToCart")} — {formatMoney(total, currency)}
          </button>
        </div>
      </div>
    </div>
  );
}
