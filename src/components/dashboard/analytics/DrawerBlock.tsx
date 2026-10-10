"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateLocale, formatMoney } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { CashMovement, Drawer } from "@/lib/cash-drawer";
import CashMovementDialog from "./CashMovementDialog";

interface DrawerBlockProps {
  drawer: Drawer;
  currency: string;
  timeZone: string;
}

/**
 * The cash drawer, as the sum it is: what the day started with, plus the cash
 * taken, minus what was taken out, equals what should be in it now. Laid out
 * like the corte beside it — one column of figures, the total ruled under it —
 * because counting a drawer means running your eye down a column.
 *
 * Cash only. Card and online money never sits in a drawer.
 */
export default function DrawerBlock({ drawer, currency, timeZone }: DrawerBlockProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<"opening" | "withdrawal" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const money = (n: number) => formatMoney(n, currency);
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(dateLocale(locale), { timeZone, hour: "2-digit", minute: "2-digit" });

  async function strike(w: CashMovement): Promise<void> {
    const ok = await confirm({
      title: t("corte.removeWithdrawalTitle", { amount: money(w.amount) }),
      message: t("corte.removeWithdrawalMsg"),
      confirmLabel: t("corte.removeWithdrawal"),
    });
    if (!ok) return;
    setBusy(w.id);
    try {
      const res = await fetch("/api/cash-drawer", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: w.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast(data.error ?? t("done.networkError"), "error");
      else {
        toast(t("corte.withdrawalRemoved"));
        router.refresh();
      }
    } catch {
      toast(t("done.networkError"), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="tt-cashbox">
      <div className="tt-cashbox-head">
        <strong>{t("corte.drawer")}</strong>
        <div className="tt-cashbox-actions">
          <button className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setDialog("opening")}>
            {drawer.openingSet ? t("corte.changeOpening") : t("corte.setOpening")}
          </button>
          <button className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setDialog("withdrawal")}>
            {t("corte.addWithdrawal")}
          </button>
        </div>
      </div>

      <div className="tt-cashbox-sum" role="table" aria-label={t("corte.drawer")}>
        <div className="tt-cashbox-line" role="row">
          <span role="cell">{t("corte.opening")}</span>
          <span role="cell">{drawer.openingSet ? money(drawer.opening) : t("corte.openingNotSet")}</span>
        </div>
        <div className="tt-cashbox-line" role="row">
          <span role="cell">+ {t("corte.cashSales")}</span>
          <span role="cell">{money(drawer.cashSales)}</span>
        </div>
        <div className="tt-cashbox-line" role="row">
          <span role="cell">− {t("corte.withdrawals")}</span>
          <span role="cell">{money(drawer.withdrawn)}</span>
        </div>
        <div className="tt-cashbox-line tt-cashbox-total" role="row">
          <strong role="cell">{t("corte.expected")}</strong>
          <strong role="cell">{money(drawer.expected)}</strong>
        </div>
      </div>

      {drawer.withdrawals.length > 0 && (
        <ul className="tt-cashbox-list">
          {drawer.withdrawals.map(w => (
            <li key={w.id} className="tt-cashbox-item">
              <span className="tt-cashbox-what">
                <strong>{money(w.amount)}</strong>
                <span className="tt-muted">
                  {time(w.created_at)} · {w.actor_email}
                  {w.note ? ` · ${w.note}` : ""}
                </span>
              </span>
              <button
                className="tt-btn tt-btn-ghost tt-btn-sm"
                disabled={busy === w.id}
                onClick={() => void strike(w)}
              >
                {t("corte.removeWithdrawal")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="tt-muted tt-cashbox-note">{t("corte.drawerHint")}</p>

      <CashMovementDialog
        kind={dialog}
        opening={drawer.opening}
        onClose={() => setDialog(null)}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
