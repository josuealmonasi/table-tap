"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { formatMoney } from "@/lib/format";
import { amount, inShown } from "@/lib/costs/display";
import { WASTE_REASONS } from "@/lib/costs/usage";
import type { StockView } from "@/lib/costs/stock-server";
import { useCostsSend } from "@/hooks/useCostsSend";
import { useWhen } from "@/hooks/useWhen";
import { DeleteIcon } from "@/components/ui/icons";

interface WastePanelProps {
  stock: StockView;
  currency: string;
  timeZone?: string;
}

/**
 * What was thrown away in the last 30 days: what it cost, by reason, and
 * each entry — who recorded it, and a way for a manager to take back one
 * made by mistake. The team records it on its own screen.
 */
export default function WastePanel({ stock, currency, timeZone }: WastePanelProps) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const send = useCostsSend();
  const when = useWhen(timeZone);
  const money = (n: number) => formatMoney(n, currency);
  const unitOf = new Map(stock.ingredients.map(i => [i.id, i.unit]));

  async function remove(id: string): Promise<void> {
    const ok = await confirm({ title: t("costs.wasteRemoveConfirm"), confirmLabel: t("costs.wasteRemove"), danger: true });
    if (!ok) return;
    const failed = await send("/api/costs/waste", "DELETE", { id });
    toast(failed ?? t("costs.wasteRemoved"), failed ? "error" : undefined);
    if (!failed) router.refresh();
  }

  const quantityOf = (e: StockView["waste"][number]) => {
    const unit = e.ingredient_id ? unitOf.get(e.ingredient_id) : undefined;
    if (!unit) return `${amount(e.quantity)} ${t("costs.unitShort.pza")}`;
    const shown = inShown(e.quantity, unit);
    return `${amount(shown.amount)} ${t(`costs.unitShort.${shown.unit}`)}`;
  };

  return (
    <>
      <section className="tt-costs-period" aria-label={t("costs.wasteTitle")}>
        <div className="tt-section-head">
          <h2 className="tt-costs-heading">{t("costs.wasteTitle")}</h2>
          <Link href="/dashboard/waste" className="tt-btn tt-btn-primary tt-btn-sm">+ {t("costs.wasteRecord")}</Link>
        </div>
        <div className="tt-analytics-tiles">
          {WASTE_REASONS.map(r => (
            <div key={r} className="tt-analytics-tile">
              <strong>{money(stock.wasteByReason[r])}</strong>
              <span>{t(`costs.reason.${r}`)}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="tt-section">
        {stock.waste.length === 0 ? (
          <p className="tt-muted">{t("costs.wasteEmpty")}</p>
        ) : (
          <ul className="tt-costs-products">
            {stock.waste.map(e => (
              <li key={e.id} className="tt-costs-entry">
                <span className="tt-costs-product-name">{e.name}</span>
                <span className="tt-costs-margin">{e.cost === null ? t("costs.wasteNoCost") : money(e.cost)}</span>
                <span className="tt-costs-product-meta tt-muted">
                  {quantityOf(e)} · {t(`costs.reason.${e.reason}`)} · {e.recorded_by} · {when(e.created_at)}
                  {e.note && ` · ${e.note}`}
                </span>
                <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm tt-costs-entry-remove"
                  aria-label={t("costs.wasteRemove")} onClick={() => void remove(e.id)}>
                  <DeleteIcon size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
