"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { percent } from "@/lib/costs/display";
import { recipeQuantity } from "@/lib/costs/input";
import { unitMargin } from "@/lib/costs/margins";
import { recipeBook, unitCosts, type Ingredient, type RecipeLine } from "@/lib/costs/recipe-cost";
import type { CostedProduct } from "@/lib/costs/server";
import { useCostsSend } from "@/hooks/useCostsSend";
import RecipeLineRow, { choiceOf, choiceValue, type DraftLine } from "./RecipeLineRow";

interface RecipeDialogProps {
  product: CostedProduct | null;
  ingredients: Ingredient[];
  recipes: RecipeLine[];
  feeRate: number;
  taxPct: number;
  currency: string;
  onClose: () => void;
}

/** One product's recipe, edited as a whole and saved as a whole. */
export default function RecipeDialog({ product, onClose, ...rest }: RecipeDialogProps) {
  const t = useT();
  return (
    <Modal open={product !== null} onClose={onClose} maxWidth={560} title={product ? t("costs.recipeTitle", { name: product.name }) : ""}>
      {/* Keyed by the product, so each one opens on its own saved recipe. */}
      {product && <RecipeForm key={product.id} product={product} onClose={onClose} {...rest} />}
    </Modal>
  );
}

let nextKey = 0;
const draftOf = (line: RecipeLine): DraftLine => ({
  key: String(nextKey++),
  ingredientId: line.ingredient_id,
  quantity: String(line.quantity),
  when: line.mod_label && line.mod_option ? choiceValue(line.mod_label, line.mod_option) : "",
});

function RecipeForm({ product, ingredients, recipes, feeRate, taxPct, currency, onClose }: Omit<RecipeDialogProps, "product"> & { product: CostedProduct }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const send = useCostsSend();
  const [lines, setLines] = useState<DraftLine[]>(() => recipes.filter(r => r.item_id === product.id).map(draftOf));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const money = (n: number) => formatMoney(n, currency);
  const choices = useMemo(
    () => product.modifiers.flatMap(m => m.options.map(o => ({ value: choiceValue(m.label, o), label: `${m.label}: ${o}` }))),
    [product.modifiers],
  );

  const recipe: RecipeLine[] = lines.flatMap(l => {
    const quantity = recipeQuantity(l.quantity);
    if (!l.ingredientId || quantity === null) return [];
    const choice = choiceOf(l.when);
    return [{ item_id: product.id, ingredient_id: l.ingredientId, quantity, mod_label: choice?.[0] ?? null, mod_option: choice?.[1] ?? null }];
  });
  const preview = unitMargin(product, recipeBook(recipe), unitCosts(ingredients), feeRate, taxPct);

  const update = (key: string, change: Partial<DraftLine>) =>
    setLines(ls => ls.map(l => (l.key === key ? { ...l, ...change } : l)));

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const failed = await send("/api/costs/recipe", "PUT", {
      itemId: product.id,
      lines: lines.map(l => {
        const choice = choiceOf(l.when);
        return { ingredientId: l.ingredientId, quantity: l.quantity, modLabel: choice?.[0], modOption: choice?.[1] };
      }),
    });
    setBusy(false);
    if (failed) return setError(failed);
    toast(t("costs.recipeSaved"));
    onClose();
    router.refresh();
  }

  return (
    <form className="tt-prodform" onSubmit={e => void save(e)}>
      <p className="tt-muted tt-costs-hint">
        {t("costs.recipePrice", { price: money(preview.price), net: money(preview.net) })}
      </p>
      <p className="tt-muted tt-costs-hint">{t("costs.recipeHint")}</p>
      {ingredients.length === 0 ? (
        <p className="tt-costs-warning">{t("costs.recipeNoIngredients")}</p>
      ) : (
        <>
          {lines.length === 0 && <p className="tt-muted">{t("costs.recipeEmpty")}</p>}
          <ul className="tt-recipe-lines">
            {lines.map(l => (
              <RecipeLineRow
                key={l.key}
                line={l}
                ingredients={ingredients}
                choices={choices}
                onChange={change => update(l.key, change)}
                onRemove={() => setLines(ls => ls.filter(x => x.key !== l.key))}
              />
            ))}
          </ul>
          <button
            type="button"
            className="tt-btn tt-btn-ghost tt-btn-sm"
            onClick={() => setLines(ls => [...ls, { key: String(nextKey++), ingredientId: "", quantity: "", when: "" }])}
          >
            + {t("costs.recipeAdd")}
          </button>
        </>
      )}
      {preview.cost !== null && preview.margin !== null && (
        <p className="tt-costs-preview" role="status">
          <strong>
            {t("costs.recipeCost", {
              cost: money(preview.cost),
              margin: money(preview.margin),
              pct: preview.marginPct === null ? "—" : percent(preview.marginPct),
            })}
          </strong>
          <span className="tt-muted">{t("costs.recipeCostDefault")}</span>
        </p>
      )}
      {error && <p className="tt-field-error" role="alert">{error}</p>}
      <div className="tt-prodform-actions">
        <button type="submit" className="tt-btn tt-btn-primary" disabled={busy || ingredients.length === 0}>
          {busy ? t("common.saving") : t("common.save")}
        </button>
        <button type="button" className="tt-btn tt-btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      </div>
    </form>
  );
}
