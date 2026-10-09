"use client";

import { useState } from "react";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateLocale } from "@/lib/format";
import { planLabel } from "@/lib/plan";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { DeleteIcon } from "@/components/ui/icons";
import type { AdminRestaurantRow } from "./AdminPanel";

interface AdminRestaurantsProps {
  restaurants: AdminRestaurantRow[];
  /** Every plan in the catalog, cheapest first. */
  plans: string[];
  busy: boolean;
  /** Resolves true when the move was made. */
  onMovePlan: (id: string, plan: string, doneMsg: string) => Promise<boolean>;
  onDelete: (id: string) => void;
}

/**
 * Every restaurant, with its plan and the way to change it.
 *
 * Moving a restaurant moves its whole team: a plan belongs to the restaurant,
 * not to any one login. Asked first, because what the team can use changes the
 * moment it is confirmed.
 */
export default function AdminRestaurants({ restaurants, plans, busy, onMovePlan, onDelete }: AdminRestaurantsProps) {
  const t = useT();
  const { locale } = useLocale();
  const confirm = useConfirm();
  // The plan chosen, shown at once rather than after the page reloads — and
  // put back if the move was refused.
  const [shown, setShown] = useState<Record<string, string>>({});

  async function move(r: AdminRestaurantRow, plan: string): Promise<void> {
    if (plan === (shown[r.id] ?? r.plan)) return;
    const name = r.name;
    const ok = await confirm({
      title: t("admin.planConfirmTitle", { name, plan: planLabel(plan) }),
      message: t("admin.planConfirmMsg", { plan: planLabel(plan) }),
      confirmLabel: t("common.confirm"),
    });
    if (!ok) return;
    setShown(s => ({ ...s, [r.id]: plan }));
    const moved = await onMovePlan(r.id, plan, t("admin.planMoved", { name, plan: planLabel(plan) }));
    if (!moved) setShown(s => ({ ...s, [r.id]: r.plan }));
  }

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("admin.restaurants")}
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {t("admin.total", { n: restaurants.length })}
        </span>
      </div>
      <div className="tt-admin-table">
        <div className="tt-admin-tr tt-admin-tr--rest tt-staff-thead" aria-hidden="true">
          <span>{t("admin.restaurant")}</span>
          <span>{t("admin.foundingOwner")}</span>
          <span>{t("admin.plan")}</span>
          <span>{t("admin.team")}</span>
          <span>{t("admin.created")}</span>
          <span />
        </div>
        {restaurants.map(r => (
          <div key={r.id} className="tt-admin-tr tt-admin-tr--rest">
            <span className="tt-staff-cell" title={r.name}>
              <strong>{r.name}</strong>
            </span>
            <span className="tt-staff-cell tt-muted" title={r.owner_email}>
              {r.owner_email}
            </span>
            <select
              className="tt-input tt-admin-plan"
              aria-label={t("admin.plan")}
              value={shown[r.id] ?? r.plan}
              disabled={busy}
              onChange={e => void move(r, e.target.value)}
            >
              {plans.map(p => (
                <option key={p} value={p}>
                  {planLabel(p)}
                </option>
              ))}
            </select>
            <span>{r.team_count}</span>
            <span className="tt-muted" style={{ fontSize: 12 }}>
              {new Date(r.created_at).toLocaleDateString(dateLocale(locale), {
                day: "2-digit",
                month: "short",
              })}
            </span>
            <button
              className="tt-iconbtn"
              title={t("admin.deleteRestaurant")}
              disabled={busy}
              onClick={async () => {
                if (
                  await confirm({
                    title: t("admin.deleteRestaurantConfirm", { name: r.name }),
                    message: t("admin.deleteRestaurantMsg"),
                    confirmLabel: t("admin.deleteRestaurant"),
                    danger: true,
                  })
                ) {
                  onDelete(r.id);
                }
              }}
            >
              <DeleteIcon size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
