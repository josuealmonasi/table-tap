"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { amount, fromShown, inShown } from "@/lib/costs/display";
import { decimal } from "@/lib/costs/input";
import type { StockIngredient } from "@/lib/costs/stock-server";

interface CountDialogProps {
  open: boolean;
  ingredients: StockIngredient[];
  currency: string;
  onClose: () => void;
}

interface CountResult {
  ingredientId: string;
  counted: number;
  expected: number | null;
}

/**
 * Counting the shelf. Nothing but the names and an empty box each: the
 * expected figures come back only once the count is saved, and then the
 * count stands — like the drawer's, a count made after seeing the answer is
 * not a count. Typed in kg, l or pieces, the way a shelf is counted.
 */
export default function CountDialog({ open, onClose, ...rest }: CountDialogProps) {
  const t = useT();
  return (
    <Modal open={open} onClose={onClose} maxWidth={520} title={t("costs.countTitle")}>
      {open && <CountForm onClose={onClose} {...rest} />}
    </Modal>
  );
}

function CountForm({ ingredients, currency, onClose }: Omit<CountDialogProps, "open">) {
  const t = useT();
  const router = useRouter();
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [results, setResults] = useState<CountResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(ingredients.map(i => [i.id, i]));
  const label = (n: number, unit: StockIngredient["unit"]) => {
    const shown = inShown(n, unit);
    return `${amount(shown.amount)} ${t(`costs.unitShort.${shown.unit}`)}`;
  };

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const counts = Object.entries(typed)
      .filter(([, v]) => v.trim() !== "")
      .map(([ingredientId, v]) => {
        const shown = decimal(v, 10_000_000, 3);
        return { ingredientId, counted: shown === null ? v : fromShown(shown, byId.get(ingredientId)!.unit) };
      });
    if (counts.length === 0) return setError(t("costs.countNothing"));
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/costs/counts", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ counts }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(typeof data.error === "string" ? data.error : t("apiErr.generic"));
      setResults(data.results);
      router.refresh();
    } catch {
      setError(t("done.networkError"));
    } finally {
      setBusy(false);
    }
  }

  if (results) {
    return (
      <div className="tt-prodform">
        <h3 className="tt-costs-heading">{t("costs.countResults")}</h3>
        <ul className="tt-costs-count-results">
          {results.map(r => {
            const i = byId.get(r.ingredientId);
            if (!i) return null;
            const diff = r.expected === null ? null : r.counted - r.expected;
            return (
              <li key={r.ingredientId}>
                <strong>{i.name}</strong>
                <span className={diff !== null && diff < -0.0005 ? "tt-costs-loss" : "tt-muted"}>
                  {diff === null
                    ? t("costs.countFirst")
                    : Math.abs(diff) < 0.0005
                      ? t("costs.countMatch")
                      : t(diff < 0 ? "costs.countShort" : "costs.countOver", {
                          amount: label(Math.abs(diff), i.unit),
                          cost: formatMoney(Math.abs(diff) * i.unit_cost, currency),
                        })}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="tt-prodform-actions">
          <button type="button" className="tt-btn tt-btn-primary" onClick={onClose}>{t("costs.countDone")}</button>
        </div>
      </div>
    );
  }

  return (
    <form className="tt-prodform" onSubmit={e => void save(e)}>
      <p className="tt-muted tt-costs-hint">{t("costs.countHint")}</p>
      <ul className="tt-costs-count-list">
        {ingredients.map(i => {
          const unit = inShown(0, i.unit).unit;
          return (
            <li key={i.id}>
              <label className="tt-costs-count-row">
                <span>{i.name}</span>
                <span className="tt-costs-count-input">
                  <input className="tt-input" inputMode="decimal" value={typed[i.id] ?? ""}
                    onChange={e => setTyped(v => ({ ...v, [i.id]: e.target.value }))} />
                  <span className="tt-muted">{t(`costs.unitShort.${unit}`)}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {error && <p className="tt-field-error" role="alert">{error}</p>}
      <div className="tt-prodform-actions">
        <button type="submit" className="tt-btn tt-btn-primary" disabled={busy}>
          {busy ? t("common.saving") : t("costs.countSave")}
        </button>
        <button type="button" className="tt-btn tt-btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      </div>
    </form>
  );
}
