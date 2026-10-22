"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PendingAttempt from "@/components/ui/PendingAttempt";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { amount, change } from "@/lib/costs/display";
import { decimal, packLabel, packPrice } from "@/lib/costs/input";
import type { StockIngredient } from "@/lib/costs/stock-server";
import { useCostsSend } from "@/hooks/useCostsSend";

interface PurchaseDialogProps {
  open: boolean;
  ingredients: StockIngredient[];
  currency: string;
  onClose: () => void;
}

/**
 * A delivery: what came in, how many packs, what was paid. The price per
 * pack it works out to is shown against what the ingredient cost before —
 * this is where a supplier's rise is first noticed, and saving it makes it
 * the ingredient's price.
 */
export default function PurchaseDialog({ open, onClose, ...rest }: PurchaseDialogProps) {
  const t = useT();
  const send = useCostsSend(true);
  const [reviewedIngredients, setReviewedIngredients] = useState(rest.ingredients);
  if (!send.pending() && reviewedIngredients !== rest.ingredients) setReviewedIngredients(rest.ingredients);
  return (
    <Modal open={open} onClose={onClose} maxWidth={460} title={t("costs.purchaseTitle")}>
      {open && <PurchaseForm send={send} onClose={onClose} {...rest} ingredients={send.pending() ? reviewedIngredients : rest.ingredients} />}
    </Modal>
  );
}

function PurchaseForm({ ingredients, currency, onClose, send }: Omit<PurchaseDialogProps, "open"> & { send: ReturnType<typeof useCostsSend> }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const frozen = send.frozen<{ ingredientId: string; packs: string; total: string }>();
  const pending = send.pending();
  const [ingredientId, setIngredientId] = useState(frozen?.ingredientId ?? "");
  const [packs, setPacks] = useState(frozen?.packs ?? "");
  const [total, setTotal] = useState(frozen?.total ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ingredient = ingredients.find(i => i.id === ingredientId) ?? null;
  const n = decimal(packs, 10_000, 3);
  const paid = packPrice(total);
  const each = n && paid !== null ? paid / n : null;
  const pack = ingredient ? packLabel(ingredient.pack_size, ingredient.unit) : null;

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const failed = await send("/api/costs/purchases", "POST", { ingredientId, packs, total });
    setBusy(false);
    if (failed) return setError(failed);
    toast(t("costs.purchaseSaved"));
    onClose();
    router.refresh();
  }

  return (
    <form className="tt-prodform" onSubmit={e => void save(e)}>
      {pending && <PendingAttempt message={t("pending.purchase")} busy={busy} onDiscard={send.discard} />}
      <label className="tt-field">
        <span className="tt-mod-label">{t("costs.purchaseIngredient")}</span>
        <select disabled={busy || pending} className="tt-input" value={ingredientId} onChange={e => setIngredientId(e.target.value)} required>
          <option value="">{t("waste.choose")}</option>
          {ingredients.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </label>
      <label className="tt-field">
        <span className="tt-mod-label">
          {t("costs.purchasePacks")}
          {pack && <span className="tt-muted"> ({amount(pack.size)} {t(`costs.unitShort.${pack.unit}`)})</span>}
        </span>
        <input disabled={busy || pending} className="tt-input" inputMode="decimal" value={packs} onChange={e => setPacks(e.target.value)} required />
      </label>
      <label className="tt-field">
        <span className="tt-mod-label">{t("costs.purchaseTotal")}</span>
        <input disabled={busy || pending} className="tt-input" inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)} required />
        {ingredient && each !== null && (
          <span className="tt-muted tt-costs-hint" role="status">
            {t("costs.purchasePreview", {
              price: formatMoney(each, currency),
              change: change(ingredient.pack_price, each) || "=",
            })}
          </span>
        )}
      </label>
      {error && <p className="tt-field-error" role="alert">{error}</p>}
      <div className="tt-prodform-actions">
        <button type="submit" className="tt-btn tt-btn-primary" disabled={busy || !ingredientId || !packs || !total}>
          {busy ? t("common.saving") : pending ? t("pending.sendAgain") : t("costs.purchaseRecord")}
        </button>
        <button type="button" className="tt-btn tt-btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      </div>
    </form>
  );
}
