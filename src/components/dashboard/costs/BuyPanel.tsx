"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";
import { amount } from "@/lib/costs/display";
import { packLabel } from "@/lib/costs/input";
import type { Suggestion } from "@/lib/costs/stock";
import type { StockView } from "@/lib/costs/stock-server";
import { useCostsSend } from "@/hooks/useCostsSend";
import { useWhen } from "@/hooks/useWhen";
import PurchaseDialog from "./PurchaseDialog";

interface BuyPanelProps {
  stock: StockView;
  currency: string;
  timeZone?: string;
}

/**
 * What to buy, by supplier, ready to send; the days it should cover; and the
 * deliveries that came in, which is where a supplier's new price is noticed.
 */
export default function BuyPanel({ stock, currency, timeZone }: BuyPanelProps) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const send = useCostsSend();
  const when = useWhen(timeZone);
  const [days, setDays] = useState(String(stock.coverDays));
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const money = (n: number) => formatMoney(n, currency);
  const nameOf = new Map(stock.ingredients.map(i => [i.id, i]));
  const packsOf = (s: Suggestion) => {
    const pack = packLabel(s.packSize, s.unit);
    return `${s.packs} × ${amount(pack.size)} ${t(`costs.unitShort.${pack.unit}`)}`;
  };

  const bySupplier = new Map<string, Suggestion[]>();
  for (const s of stock.suggestions) {
    const key = s.supplier ?? "";
    bySupplier.set(key, [...(bySupplier.get(key) ?? []), s]);
  }

  async function saveDays(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const failed = await send("/api/costs/settings", "PATCH", { purchaseCoverDays: days });
    if (failed) return setError(failed);
    router.refresh();
  }

  async function copy(supplier: string, list: Suggestion[]): Promise<void> {
    const text = [
      t("costs.buyOrderHead", { supplier: supplier || t("costs.buyNoSupplier") }),
      ...list.map(s => `- ${s.name}: ${packsOf(s)}`),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast(t("costs.buyCopied"));
    } catch {
      toast(t("costs.buyCopyFailed"), "error");
    }
  }

  return (
    <>
      <section className="tt-section">
        <div className="tt-section-head">
          <h2 className="tt-costs-heading">{t("costs.buyTitle")}</h2>
          <button type="button" className="tt-btn tt-btn-primary tt-btn-sm" onClick={() => setRecording(true)}
            disabled={stock.ingredients.length === 0}>
            + {t("costs.purchaseRecord")}
          </button>
        </div>
        <p className="tt-muted tt-costs-hint">{t("costs.buyHint", { days: stock.coverDays })}</p>
        <form className="tt-costs-fee-form" onSubmit={e => void saveDays(e)}>
          <label className="tt-field">
            <span className="tt-mod-label">{t("costs.buyCover")}</span>
            <input className="tt-input" inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} />
          </label>
          <button type="submit" className="tt-btn tt-btn-ghost tt-btn-sm" disabled={days.trim() === String(stock.coverDays)}>
            {t("common.save")}
          </button>
        </form>
        {error && <p className="tt-field-error" role="alert">{error}</p>}
        {stock.suggestions.length === 0 ? (
          <p className="tt-muted">{t("costs.buyEmpty")}</p>
        ) : (
          [...bySupplier].map(([supplier, list]) => (
            <div key={supplier || "none"} className="tt-costs-supplier">
              <div className="tt-section-head">
                <h3 className="tt-costs-heading">{supplier || t("costs.buyNoSupplier")}</h3>
                <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => void copy(supplier, list)}>
                  {t("costs.buyCopy")}
                </button>
              </div>
              <ul className="tt-costs-products">
                {list.map(s => (
                  <li key={s.ingredientId} className="tt-costs-entry">
                    <span className="tt-costs-product-name">{s.name}</span>
                    <span className="tt-costs-margin">{packsOf(s)}</span>
                    <span className="tt-costs-product-meta tt-muted">
                      {s.urgent && <span className="tt-costs-chip">{t("costs.buyUrgent")}</span>}{" "}
                      {t("costs.buyEstimate", { amount: money(s.cost) })}
                      {s.onHand === null && ` · ${t("costs.buyNotCounted")}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
      <section className="tt-section">
        <h2 className="tt-costs-heading">{t("costs.purchasesTitle")}</h2>
        {stock.purchases.length === 0 ? (
          <p className="tt-muted">{t("costs.purchasesEmpty")}</p>
        ) : (
          <ul className="tt-costs-products">
            {stock.purchases.map(p => {
              const i = nameOf.get(p.ingredient_id);
              const packs = i ? amount(p.quantity / i.pack_size) : "";
              return (
                <li key={p.id} className="tt-costs-entry">
                  <span className="tt-costs-product-name">{i?.name ?? "—"}</span>
                  <span className="tt-costs-margin">{money(p.total)}</span>
                  <span className="tt-costs-product-meta tt-muted">
                    {t("costs.purchaseLine", { packs })} · {p.recorded_by} · {when(p.created_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <PurchaseDialog open={recording} ingredients={stock.ingredients} currency={currency} onClose={() => setRecording(false)} />
    </>
  );
}
