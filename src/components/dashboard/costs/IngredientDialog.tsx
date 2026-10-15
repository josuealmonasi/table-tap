"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { amount, perShownUnit } from "@/lib/costs/display";
import { INGREDIENT_UNITS, packLabel, packPrice, packSize, packUnitsFor, type IngredientUnit, type PackUnit } from "@/lib/costs/input";
import type { Ingredient } from "@/lib/costs/recipe-cost";
import { useCostsSend } from "@/hooks/useCostsSend";

interface IngredientDialogProps {
  open: boolean;
  /** The one being edited, or null for a new one. */
  ingredient: Ingredient | null;
  currency: string;
  onClose: () => void;
  onArchive: (ingredient: Ingredient) => void;
}

/** Adding an ingredient, or changing one: its name, its pack and what the pack costs. */
export default function IngredientDialog({ open, ingredient, ...rest }: IngredientDialogProps) {
  const t = useT();
  return (
    <Modal
      open={open}
      onClose={rest.onClose}
      maxWidth={460}
      title={ingredient ? t("costs.editIngredient", { name: ingredient.name }) : t("costs.newIngredient")}
    >
      {open && <IngredientForm key={ingredient?.id ?? "new"} ingredient={ingredient} {...rest} />}
    </Modal>
  );
}

function IngredientForm({ ingredient, currency, onClose, onArchive }: Omit<IngredientDialogProps, "open">) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const send = useCostsSend();
  const start = ingredient ? packLabel(ingredient.pack_size, ingredient.unit) : null;
  const [name, setName] = useState(ingredient?.name ?? "");
  const [unit, setUnit] = useState<IngredientUnit>(ingredient?.unit ?? "g");
  const [size, setSize] = useState(start ? amount(start.size) : "");
  const [packUnit, setPackUnit] = useState<PackUnit>(start?.unit ?? "kg");
  const [price, setPrice] = useState(ingredient ? String(ingredient.pack_price) : "");
  const [supplier, setSupplier] = useState(ingredient?.supplier ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inBase = packSize(size, packUnit, unit);
  const cost = packPrice(price);
  const shown = inBase && cost !== null ? perShownUnit(cost / inBase, unit) : null;

  function chooseUnit(next: IngredientUnit): void {
    setUnit(next);
    setPackUnit(packUnitsFor(next)[0]);
  }

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { name, packSize: size, packUnit, packPrice: price, supplier: supplier.trim() || undefined };
    const failed = ingredient
      ? await send("/api/costs/ingredients", "PATCH", { id: ingredient.id, ...body })
      : await send("/api/costs/ingredients", "POST", { ...body, unit });
    setBusy(false);
    if (failed) return setError(failed);
    toast(t("costs.saved", { name: name.trim() }));
    onClose();
    router.refresh();
  }

  return (
    <form className="tt-prodform" onSubmit={e => void save(e)}>
      <label className="tt-field">
        <span className="tt-mod-label">{t("costs.name")}</span>
        <input className="tt-input" value={name} onChange={e => setName(e.target.value)} maxLength={80}
          placeholder={t("costs.namePlaceholder")} autoFocus required />
      </label>
      <label className="tt-field">
        <span className="tt-mod-label">{t("costs.unit")}</span>
        <select className="tt-input" value={unit} disabled={ingredient !== null} onChange={e => chooseUnit(e.target.value as IngredientUnit)}>
          {INGREDIENT_UNITS.map(u => <option key={u} value={u}>{t(`costs.unitName.${u}`)}</option>)}
        </select>
        {ingredient && <span className="tt-muted tt-costs-hint">{t("costs.unitFixed")}</span>}
      </label>
      <div className="tt-field">
        <span className="tt-mod-label" id="tt-pack-label">{t("costs.pack")}</span>
        <div className="tt-costs-pack" role="group" aria-labelledby="tt-pack-label">
          <input className="tt-input" inputMode="decimal" value={size} onChange={e => setSize(e.target.value)}
            aria-label={t("costs.packSize")} required />
          <select className="tt-input" value={packUnit} onChange={e => setPackUnit(e.target.value as PackUnit)}
            aria-label={t("costs.packUnit")}>
            {packUnitsFor(unit).map(u => <option key={u} value={u}>{t(`costs.unitShort.${u}`)}</option>)}
          </select>
        </div>
      </div>
      <label className="tt-field">
        <span className="tt-mod-label">{t("costs.packPriceLabel")}</span>
        <input className="tt-input" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} required />
        {shown && (
          <span className="tt-muted tt-costs-hint" role="status">
            {t("costs.unitCostPreview", { cost: formatMoney(shown.amount, currency), unit: t(`costs.unitShort.${shown.unit}`) })}
          </span>
        )}
      </label>
      <label className="tt-field">
        <span className="tt-mod-label">{t("costs.supplier")} <span className="tt-muted">{t("common.optional")}</span></span>
        <input className="tt-input" value={supplier} onChange={e => setSupplier(e.target.value)} maxLength={80} />
      </label>
      {error && <p className="tt-field-error" role="alert">{error}</p>}
      <div className="tt-prodform-actions">
        <button type="submit" className="tt-btn tt-btn-primary" disabled={busy || !name.trim() || !size || !price}>
          {busy ? t("common.saving") : t("common.save")}
        </button>
        <button type="button" className="tt-btn tt-btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
        {ingredient && (
          <button type="button" className="tt-btn tt-btn-ghost tt-costs-archive" onClick={() => onArchive(ingredient)}>
            {t("costs.archive")}
          </button>
        )}
      </div>
    </form>
  );
}
