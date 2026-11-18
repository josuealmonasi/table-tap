"use client";

import { useState } from "react";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateLocale } from "@/lib/format";
import { planLabel } from "@/lib/plan";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { DeleteIcon } from "@/components/ui/icons";
import type { AdminRestaurantRow } from "./AdminPanel";
import BillingLine from "./AdminBillingLine";
import AdminTierDialog, { type TierAssignment } from "./AdminTierDialog";

interface AdminRestaurantsProps {
  restaurants: AdminRestaurantRow[];
  /** Every plan in the catalog, cheapest first. */
  plans: string[];
  busy: boolean;
  /** Resolves true when the move was made. */
  onMovePlan: (id: string, plan: string, doneMsg: string, choice: TierAssignment) => Promise<boolean>;
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

  // The tier picked in a row, waiting for the admin to say how it is paid.
  const [picking, setPicking] = useState<{ row: AdminRestaurantRow; plan: string } | null>(null);

  function pick(r: AdminRestaurantRow, plan: string): void {
    if (plan === (shown[r.id] ?? r.plan)) return;
    setPicking({ row: r, plan });
  }

  async function assign(choice: TierAssignment): Promise<void> {
    if (!picking) return;
    const { row: r, plan } = picking;
    setPicking(null);
    setShown(s => ({ ...s, [r.id]: plan }));
    const done = choice.billing === "payment_link" ? "admin.tierLinkSent" : choice.billing === "next_bill" ? "admin.tierNextBillDone" : "admin.planMoved";
    const moved = await onMovePlan(r.id, plan, t(done, { name: r.name, plan: planLabel(plan) }), choice);
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
              <BillingLine billing={r.billing} />
            </span>
            <span className="tt-staff-cell tt-muted" title={r.owner_email}>
              {r.owner_email}
            </span>
            <select
              className="tt-input tt-admin-plan"
              aria-label={t("admin.plan")}
              value={shown[r.id] ?? r.plan}
              disabled={busy}
              onChange={e => pick(r, e.target.value)}
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
      {picking ? (
        <AdminTierDialog
          name={picking.row.name}
          plan={picking.plan}
          billedByStripe={picking.row.billed_by_stripe}
          busy={busy}
          onClose={() => setPicking(null)}
          onAssign={choice => void assign(choice)}
        />
      ) : null}
    </div>
  );
}
