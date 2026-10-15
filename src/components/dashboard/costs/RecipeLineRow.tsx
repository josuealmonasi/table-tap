"use client";

import { useT } from "@/lib/i18n/context";
import type { Ingredient } from "@/lib/costs/recipe-cost";
import { CloseIcon } from "@/components/ui/icons";

/**
 * A choice as a select's value: its label and option, as JSON, since either
 * may hold any character a separator could be.
 */
export function choiceValue(label: string, option: string): string {
  return JSON.stringify([label, option]);
}

/** The label and option a select's value names, or nothing for "always". */
export function choiceOf(value: string): [string, string] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length === 2 && parsed.every(p => typeof p === "string")
      ? [parsed[0] as string, parsed[1] as string]
      : null;
  } catch {
    return null;
  }
}

export interface DraftLine {
  key: string;
  ingredientId: string;
  /** As typed; read when saved. */
  quantity: string;
  /** "" for always, or a choice's label and option. */
  when: string;
}

interface RecipeLineRowProps {
  line: DraftLine;
  ingredients: Ingredient[];
  choices: { value: string; label: string }[];
  onChange: (change: Partial<DraftLine>) => void;
  onRemove: () => void;
}

/** One ingredient in a recipe: which, how much, and whether only on a choice. */
export default function RecipeLineRow({ line, ingredients, choices, onChange, onRemove }: RecipeLineRowProps) {
  const t = useT();
  const unit = ingredients.find(i => i.id === line.ingredientId)?.unit;
  return (
    <li className="tt-recipe-line">
      <select
        className="tt-input tt-recipe-ingredient"
        aria-label={t("costs.recipeIngredient")}
        value={line.ingredientId}
        onChange={e => onChange({ ingredientId: e.target.value })}
      >
        <option value="">{t("costs.recipeIngredient")}</option>
        {ingredients.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select>
      <label className="tt-recipe-quantity">
        <input
          className="tt-input"
          inputMode="decimal"
          aria-label={t("costs.recipeQuantity")}
          placeholder={t("costs.recipeQuantity")}
          value={line.quantity}
          onChange={e => onChange({ quantity: e.target.value })}
        />
        <span className="tt-muted">{unit ? t(`costs.unitShort.${unit}`) : ""}</span>
      </label>
      {choices.length > 0 && (
        <select
          className="tt-input tt-recipe-when"
          aria-label={t("costs.recipeWhen")}
          value={line.when}
          onChange={e => onChange({ when: e.target.value })}
        >
          <option value="">{t("costs.recipeAlways")}</option>
          {choices.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      )}
      <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm tt-recipe-remove" aria-label={t("costs.recipeRemove")} onClick={onRemove}>
        <CloseIcon size={16} weight="bold" aria-hidden="true" />
      </button>
    </li>
  );
}
