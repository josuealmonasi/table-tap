"use client";

import { useState } from "react";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateLocale, formatMoney } from "@/lib/format";
import { planLabel } from "@/lib/plan";
import AdminPriceDialog from "./AdminPriceDialog";
import type { AdminPlanPrice } from "@/lib/admin-prices";

interface AdminPricesProps {
  prices: AdminPlanPrice[];
  busy: boolean;
  onSchedule: (plan: string, newPrice: number, effectiveAt: string, doneMsg: string) => Promise<boolean>;
}

/** Plan prices and the changes scheduled for them, with 30 days' notice to every owner. */
export default function AdminPrices({ prices, busy, onSchedule }: AdminPricesProps) {
  const t = useT();
  const { locale } = useLocale();
  const [editing, setEditing] = useState<AdminPlanPrice | null>(null);
  const day = (iso: string) => new Date(iso).toLocaleDateString(dateLocale(locale), { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" });

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>{t("adminPrices.title")}</h3>
      </div>
      <div className="tt-admin-table">
        {prices.map(p => (
          <div key={p.plan} className="tt-admin-price-row">
            <span className="tt-staff-cell"><strong>{planLabel(p.plan)}</strong></span>
            <span>{t("adminPrices.perMonth", { price: formatMoney(p.monthlyPrice, "MXN") })}</span>
            <span className="tt-muted tt-admin-price-next">
              {p.pending
                ? t("adminPrices.pending", { price: formatMoney(p.pending.newPrice, "MXN"), date: day(p.pending.effectiveAt), sent: p.pending.sent, queued: p.pending.queued })
                : t("adminPrices.none")}
            </span>
            <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" disabled={busy || !!p.pending} onClick={() => setEditing(p)}>
              {t("adminPrices.change")}
            </button>
          </div>
        ))}
      </div>
      {editing ? (
        <AdminPriceDialog
          plan={editing.plan}
          current={editing.monthlyPrice}
          busy={busy}
          onClose={() => setEditing(null)}
          onConfirm={(price, effectiveAt) => {
            const p = editing;
            setEditing(null);
            void onSchedule(p.plan, price, effectiveAt, t("adminPrices.scheduled", { plan: planLabel(p.plan) }));
          }}
        />
      ) : null}
    </div>
  );
}
