"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";
import { amount, fromShown, inShown } from "@/lib/costs/display";
import { decimal, type IngredientUnit } from "@/lib/costs/input";
import { WASTE_REASONS, type WasteReason } from "@/lib/costs/usage";
import { useCostsSend } from "@/hooks/useCostsSend";
import { useWhen } from "@/hooks/useWhen";

export interface WasteChoice {
  kind: "ingredient" | "product";
  id: string;
  label: string;
  unit: IngredientUnit;
}

export interface TodayEntry {
  id: string;
  name: string;
  ingredient_id: string | null;
  quantity: number;
  reason: WasteReason;
  recorded_by: string;
  created_at: string;
  /** Null for the team, who are not shown what it cost. */
  cost: number | null;
}

interface WasteRecorderProps {
  choices: WasteChoice[];
  today: TodayEntry[];
  canSeeCost: boolean;
  currency: string;
  timeZone: string;
}

/**
 * Three questions and a button: what, how much, why. An ingredient is
 * counted the way a shelf is — kg, l or pieces — and a product in whole
 * ones; a product whose stock is counted loses them from the count too.
 */
export default function WasteRecorder({ choices, today, canSeeCost, currency, timeZone }: WasteRecorderProps) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const send = useCostsSend();
  const when = useWhen(timeZone);
  const [picked, setPicked] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<WasteReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choice = choices.find(c => `${c.kind}:${c.id}` === picked) ?? null;
  const shownUnit = choice ? (choice.kind === "product" ? "pza" : inShown(0, choice.unit).unit) : null;
  const unitOf = new Map(choices.filter(c => c.kind === "ingredient").map(c => [c.id, c.unit]));

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!choice || !reason) return;
    setBusy(true);
    setError(null);
    const typed = decimal(quantity, 100_000, 3);
    const sent = choice.kind === "ingredient" && typed !== null ? fromShown(typed, choice.unit) : quantity;
    const failed = await send("/api/costs/waste", "POST", {
      [choice.kind === "ingredient" ? "ingredientId" : "itemId"]: choice.id, quantity: sent, reason, note: note.trim() || undefined,
    });
    setBusy(false);
    if (failed) return setError(failed);
    toast(t("waste.saved", { name: choice.label }));
    setPicked("");
    setQuantity("");
    setReason(null);
    setNote("");
    router.refresh();
  }

  const quantityOf = (e: TodayEntry) => {
    const unit = e.ingredient_id ? unitOf.get(e.ingredient_id) : undefined;
    if (!unit) return `${amount(e.quantity)} ${t("costs.unitShort.pza")}`;
    const shown = inShown(e.quantity, unit);
    return `${amount(shown.amount)} ${t(`costs.unitShort.${shown.unit}`)}`;
  };

  return (
    <>
      <section className="tt-section">
        <form className="tt-waste-form" onSubmit={e => void save(e)}>
          <label className="tt-field">
            <span className="tt-mod-label">{t("waste.what")}</span>
            <select className="tt-input" value={picked} onChange={e => setPicked(e.target.value)} required>
              <option value="">{t("waste.choose")}</option>
              <optgroup label={t("waste.ingredients")}>
                {choices.filter(c => c.kind === "ingredient").map(c => <option key={c.id} value={`ingredient:${c.id}`}>{c.label}</option>)}
              </optgroup>
              <optgroup label={t("waste.products")}>
                {choices.filter(c => c.kind === "product").map(c => <option key={c.id} value={`product:${c.id}`}>{c.label}</option>)}
              </optgroup>
            </select>
          </label>
          <label className="tt-field">
            <span className="tt-mod-label">{t("waste.quantity")}</span>
            <span className="tt-costs-count-input">
              <input className="tt-input" inputMode="decimal" value={quantity} onChange={e => setQuantity(e.target.value)} required />
              <span className="tt-muted">{shownUnit ? t(`costs.unitShort.${shownUnit}`) : ""}</span>
            </span>
          </label>
          <fieldset className="tt-field tt-waste-reasons">
            <legend className="tt-mod-label">{t("waste.why")}</legend>
            <div className="tt-station-filter" role="radiogroup" aria-label={t("waste.why")}>
              {WASTE_REASONS.map(r => (
                <button type="button" key={r} role="radio" aria-checked={reason === r}
                  className={`tt-chip${reason === r ? " tt-chip-on" : ""}`} onClick={() => setReason(r)}>
                  {t(`costs.reason.${r}`)}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="tt-field">
            <span className="tt-mod-label">{t("waste.note")} <span className="tt-muted">{t("common.optional")}</span></span>
            <input className="tt-input" value={note} onChange={e => setNote(e.target.value)} maxLength={140} />
          </label>
          <p className="tt-muted tt-costs-hint">{t("waste.stockNote")}</p>
          {error && <p className="tt-field-error" role="alert">{error}</p>}
          <div>
            <button type="submit" className="tt-btn tt-btn-primary" disabled={busy || !choice || !quantity || !reason}>
              {busy ? t("common.saving") : t("waste.save")}
            </button>
          </div>
        </form>
      </section>
      <section className="tt-section">
        <h2 className="tt-costs-heading">{t("waste.today")}</h2>
        {today.length === 0 ? (
          <p className="tt-muted">{t("waste.todayEmpty")}</p>
        ) : (
          <ul className="tt-costs-products">
            {today.map(e => (
              <li key={e.id} className="tt-costs-entry">
                <span className="tt-costs-product-name">{e.name}</span>
                {canSeeCost && <span className="tt-costs-margin">{e.cost === null ? t("costs.wasteNoCost") : formatMoney(e.cost, currency)}</span>}
                <span className="tt-costs-product-meta tt-muted">
                  {quantityOf(e)} · {t(`costs.reason.${e.reason}`)} · {e.recorded_by} · {when(e.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
