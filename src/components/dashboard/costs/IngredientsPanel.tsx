"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { formatMoney } from "@/lib/format";
import { amount, perShownUnit } from "@/lib/costs/display";
import { packLabel } from "@/lib/costs/input";
import type { Ingredient, RecipeLine } from "@/lib/costs/recipe-cost";
import { useCostsSend } from "@/hooks/useCostsSend";
import IngredientDialog from "./IngredientDialog";

interface IngredientsPanelProps {
  ingredients: Ingredient[];
  recipes: RecipeLine[];
  currency: string;
}

/** What the restaurant buys, each in the pack it comes in, and how many recipes use it. */
export default function IngredientsPanel({ ingredients, recipes, currency }: IngredientsPanelProps) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const send = useCostsSend();
  // "new", an ingredient's id, or nothing open.
  const [open, setOpen] = useState<string | null>(null);
  const money = (n: number) => formatMoney(n, currency);
  const usedIn = useMemo(() => {
    const items = new Map<string, Set<string>>();
    for (const r of recipes) items.set(r.ingredient_id, (items.get(r.ingredient_id) ?? new Set()).add(r.item_id));
    return items;
  }, [recipes]);
  const editing = ingredients.find(i => i.id === open) ?? null;

  // The edit dialog closes before the confirmation opens: two dialogs at once
  // fight over the keyboard and take two Escapes to leave.
  async function archive(ingredient: Ingredient): Promise<void> {
    setOpen(null);
    const ok = await confirm({
      title: t("costs.archiveConfirm", { name: ingredient.name }),
      confirmLabel: t("costs.archive"),
      danger: true,
    });
    if (!ok) return;
    const failed = await send("/api/costs/ingredients", "DELETE", { id: ingredient.id });
    toast(failed ?? t("costs.archived", { name: ingredient.name }), failed ? "error" : undefined);
    if (!failed) router.refresh();
  }

  return (
    <section className="tt-section">
      <div className="tt-section-head">
        <h2 className="tt-costs-heading">{t("costs.ingredientsTitle")}</h2>
        <button type="button" className="tt-btn tt-btn-primary tt-btn-sm" onClick={() => setOpen("new")}>
          + {t("costs.addIngredient")}
        </button>
      </div>
      <p className="tt-muted tt-costs-hint">{t("costs.ingredientsHint")}</p>
      {ingredients.length === 0 ? (
        <p className="tt-muted">{t("costs.ingredientsEmpty")}</p>
      ) : (
        <ul className="tt-costs-products">
          {ingredients.map(i => {
            const pack = packLabel(i.pack_size, i.unit);
            const shown = perShownUnit(i.unit_cost, i.unit);
            const n = usedIn.get(i.id)?.size ?? 0;
            return (
              <li key={i.id}>
                <button type="button" className="tt-costs-product" onClick={() => setOpen(i.id)}>
                  <span className="tt-costs-product-name">{i.name}</span>
                  <span className="tt-costs-margin">
                    {t("costs.unitCostLine", { cost: money(shown.amount), unit: t(`costs.unitShort.${shown.unit}`) })}
                  </span>
                  <span className="tt-costs-product-meta tt-muted">
                    {t("costs.packLine", { size: amount(pack.size), unit: t(`costs.unitShort.${pack.unit}`), price: money(i.pack_price) })}
                    {i.supplier && ` · ${i.supplier}`}
                    {" · "}
                    {n === 0 ? t("costs.notUsed") : n === 1 ? t("costs.usedInOne") : t("costs.usedInMany", { n })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <IngredientDialog
        open={open !== null}
        ingredient={open === "new" ? null : editing}
        currency={currency}
        onClose={() => setOpen(null)}
        onArchive={ingredient => void archive(ingredient)}
      />
    </section>
  );
}
